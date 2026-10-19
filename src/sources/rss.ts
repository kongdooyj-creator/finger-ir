import type { Candidate, FeedResult } from '../types.ts';

export interface Feed { source: string; url: string }

/** 기본 피드 목록 (settings.feeds 로 덮어쓸 수 있음) */
export const DEFAULT_FEEDS: Feed[] = [
  { source: '뉴스핌', url: 'https://rss.newspim.com/news/category/105' },
  { source: '전자신문', url: 'https://rss.etnews.com/02027.xml' },
  { source: '전자신문', url: 'https://rss.etnews.com/04.xml' },
  { source: '디일렉', url: 'https://cdn.thelec.kr/rss/gn_rss_allArticle.xml' },
  { source: '비즈워치', url: 'https://news.bizwatch.co.kr/rss/service/market' },
  { source: '비즈워치', url: 'https://news.bizwatch.co.kr/rss/service/mobile' },
  { source: '비즈워치', url: 'https://news.bizwatch.co.kr/rss/service/governance' },
  { source: 'Google 뉴스 검색', url: 'https://news.google.com/rss/search?q=%ED%95%91%EA%B1%B0+when:7d&hl=ko&gl=KR&ceid=KR:ko' },
  { source: 'Google 뉴스 검색', url: 'https://news.google.com/rss/search?q=%ED%95%91%EA%B1%B0+%ED%95%80%ED%85%8C%ED%81%AC+OR+%ED%95%91%EA%B1%B0+ERP+OR+%ED%95%91%EA%B1%B0+%EC%BD%94%EC%8A%A4%EB%8B%A5+when:14d&hl=ko&gl=KR&ceid=KR:ko' },
  { source: 'Bing 뉴스 검색', url: 'https://www.bing.com/news/search?q=%ED%95%91%EA%B1%B0&format=rss' },
];

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** CDATA 제거 → 엔티티 해제(이스케이프된 HTML 포함) → 태그 제거 → 남은 엔티티 해제 */
export function stripHtml(s: string): string {
  const noCdata = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const decoded = decodeEntities(noCdata);
  const noTags = decoded.replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

function tag(block: string, names: string[]): string {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1].trim();
    const self = block.match(new RegExp(`<${n}(?:\\s[^>]*)?\\shref=["']([^"']+)["'][^>]*/?>`, 'i'));
    if (self) return self[1];
  }
  return '';
}

function parseDate(s: string): string | null {
  if (!s) return null;
  const t = Date.parse(stripHtml(s));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** RSS 2.0 / Atom 을 정규식으로 파싱 (외부 의존성 없음) */
export function parseFeed(xml: string, source: string): Candidate[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>|<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  const out: Candidate[] = [];
  for (const block of items) {
    let title = stripHtml(tag(block, ['title']));
    let link = stripHtml(tag(block, ['link'])) || stripHtml(tag(block, ['guid']));
    const summary = stripHtml(tag(block, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 600);
    const date = parseDate(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    // 매체명은 source 태그에서만. author/dc:creator 는 기자명·이메일이라 쓰지 않는다
    let publisher = stripHtml(tag(block, ['source', 'News:Source']));
    // Google/Bing 뉴스는 제목 끝에 " - 매체명"
    const m = title.match(/^(.*)\s[-–|]\s([^-–|]{2,30})$/);
    if (m && (!publisher || /Google|Bing/.test(source))) {
      title = m[1].trim();
      publisher = publisher || m[2].trim();
    }
    if (!publisher || /^https?:/.test(publisher)) publisher = source.replace(/ 검색$/, '');
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ url: link, title, summary, publisher, publishedAt: date, source });
  }
  return out;
}

function detectCharset(buf: ArrayBuffer, contentType: string | null): string {
  const ct = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (ct) return ct.toLowerCase();
  const head = new TextDecoder().decode(buf.slice(0, 200));
  const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1];
  return (enc ?? 'utf-8').toLowerCase();
}

export async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FingerIRClipper/1.0; +https://finger-ir.workers.dev)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const charset = detectCharset(buf, res.headers.get('content-type'));
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFeed(feed: Feed): Promise<{ result: FeedResult; items: Candidate[] }> {
  try {
    const xml = await fetchText(feed.url);
    const items = parseFeed(xml, feed.source);
    return { result: { source: feed.source, url: feed.url, status: 'ok', found: items.length }, items };
  } catch (e) {
    return { result: { source: feed.source, url: feed.url, status: 'error', found: 0, error: String(e) }, items: [] };
  }
}
