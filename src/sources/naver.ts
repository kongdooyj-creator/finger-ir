import type { Candidate, Env, FeedResult } from '../types.ts';
import { stripHtml } from './rss.ts';

export const DEFAULT_NAVER_QUERIES = ['(주)핑거', '핑거 코스닥', '핑거 ERP', '핑거 핀테크', '핑거 박민수'];

const HOST_PUBLISHER: Record<string, string> = {
  'newspim.com': '뉴스핌', 'etnews.com': '전자신문', 'thelec.kr': '디일렉', 'bizwatch.co.kr': '비즈워치',
  'edaily.co.kr': '이데일리', 'fnnews.com': '파이낸셜뉴스', 'asiae.co.kr': '아시아경제', 'mk.co.kr': '매일경제',
  'hankyung.com': '한국경제', 'zdnet.co.kr': '지디넷코리아', 'dealsite.co.kr': '딜사이트', 'numbers.co.kr': '넘버스',
  'digitaltoday.co.kr': '디지털투데이', 'news1.kr': '뉴스1', 'yna.co.kr': '연합뉴스', 'mt.co.kr': '머니투데이',
  'sedaily.com': '서울경제', 'heraldcorp.com': '헤럴드경제', 'thebell.co.kr': '더벨', 'inews24.com': '아이뉴스24',
  'ddaily.co.kr': '디지털데일리', 'dt.co.kr': '디지털타임스', 'newsis.com': '뉴시스', 'etoday.co.kr': '이투데이',
  'infostockdaily.co.kr': '인포스탁데일리', 'pinpointnews.co.kr': '핀포인트뉴스', 'paxetv.com': '팍스경제TV',
  'news.nate.com': '네이트뉴스', 'kind.krx.co.kr': 'KIND', 'dart.fss.or.kr': 'DART',
};

export function publisherFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|news|biz|www2)\./, '');
    for (const [k, v] of Object.entries(HOST_PUBLISHER)) if (host.endsWith(k)) return v;
    return host;
  } catch { return ''; }
}

interface NaverItem { title: string; originallink: string; link: string; description: string; pubDate: string }

export async function fetchNaver(env: Env, queries: string[]): Promise<{ results: FeedResult[]; items: Candidate[] }> {
  const results: FeedResult[] = [];
  const items: Candidate[] = [];
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
    results.push({ source: '네이버 뉴스 API', url: '', status: 'skipped', found: 0, error: 'NAVER_CLIENT_ID/SECRET 미설정' });
    return { results, items };
  }
  for (const q of queries) {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=50&sort=date`;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json<{ items: NaverItem[] }>();
      let found = 0;
      for (const it of data.items ?? []) {
        const link = it.originallink || it.link;
        if (!/^https?:\/\//.test(link)) continue;
        const t = Date.parse(it.pubDate);
        items.push({
          url: link,
          title: stripHtml(it.title),
          summary: stripHtml(it.description).slice(0, 600),
          publisher: publisherFromUrl(link),
          publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
          source: '네이버 뉴스 API',
        });
        found++;
      }
      results.push({ source: `네이버 뉴스 API (${q})`, url, status: 'ok', found });
    } catch (e) {
      results.push({ source: `네이버 뉴스 API (${q})`, url, status: 'error', found: 0, error: String(e) });
    }
  }
  return { results, items };
}
