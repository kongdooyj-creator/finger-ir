/** URL 정규화와 제목 유사도 기반 중복 판정 */

const DROP_PARAMS = /^(utm_|fbclid|gclid|ref$|from$|source$|campaign|share|igshid|_ga)/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = 'https:';
    u.hash = '';
    let host = u.hostname.toLowerCase();
    host = host.replace(/^(www|m|mobile|amp)\./, '');
    const params = [...u.searchParams.entries()].filter(([k]) => !DROP_PARAMS.test(k));
    params.sort(([a], [b]) => a.localeCompare(b));
    const qs = params.map(([k, v]) => `${k}=${v}`).join('&');
    let path = u.pathname.replace(/\/+$/, '').replace(/\/(amp|m)$/, '');
    if (path === '') path = '/';
    return `${host}${path}${qs ? '?' + qs : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 제목 정규화: 매체 접미사, 괄호 태그, 기호, 공백 제거 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s[-–|]\s[^-–|]{2,30}$/, '')          // " - 매체명"
    .replace(/\[[^\]]{1,12}\]/g, '')                // [단독], [특징주]
    .replace(/[“”"'‘’`´「」『』]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function trigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length < 3) { if (s) set.add(s); return set; }
  for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
  return set;
}

export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 한쪽이 다른 쪽을 포함하는 짧은 제목(요약형)도 같은 기사로 본다 */
export function isSameTitle(a: string, b: string, threshold = 0.9): boolean {
  if (titleSimilarity(a, b) >= threshold) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 12 && l.includes(s) && s.length / l.length >= 0.7;
}
