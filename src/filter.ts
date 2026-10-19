/** "핑거" 오탐 제거 규칙. 키워드 목록은 settings(include_keywords / exclude_keywords)로 덮어쓸 수 있다. */

export const DEFAULT_INCLUDE = [
  '(주)핑거', '㈜핑거', '주식회사 핑거', '핑거(', '핑거 박민수', '박민수 대표', '박민수',
  '코스닥', '163730', 'ERP', '파로스', '스텔라', '핀테크', '핀테크 기업', 'IR', '공시',
  '세아FSI', '세아에프에스아이', '성호전자', '서룡전자', '제일엠앤에스', '제일M&S', '제일엠엔에스',
  '메가존', '미켈로', '동광명품도어', '한패스', '문페이', '삼일PwC', '라오스',
  '전환사채', 'CB', 'BW', '신주인수권', '유상증자', '유증', '희석', '감자', '자회사', '인수', 'M&A',
  '최대주주', '경영권', '지분', '투자', '계약', '수주', '매각', '상장', '주가', '종목', '증권',
  '금융', '은행', '마이데이터', '회계', '자격시험', 'AT 자격', '스테이블코인', '트래블룰', '탄소',
];

export const DEFAULT_EXCLUDE = [
  '핑거푸드', '핑거 푸드', '핑거프린트', '핑거 프린트', '핑거볼', '핑거스타일', '핑거 스타일',
  '핑거팁', '핑거 팁', '핑거라임', '핑거 라임', '골드핑거', '핑거스냅', '핑거 스냅', '핑거보드',
  '핑거 보드', '핑거하트', '핑거 하트', '핑거리스', '핑거 페인팅', '핑거페인팅', '핑거 레스토랑',
  '손가락', '핑거 액션', '핑거액션', '핑거모션', '핑거허트', '핑거스', '핑거 쿠키', '핑거쿠키', '핑거 샌드위치', '핑거 레이스',
  '핑거 조이스틱', '핑거 피아노', '핑거 탭', '핑거 슈즈', '핑거 글러브', '핑거프린팅',
];

export interface FilterResult { pass: boolean; reason: string }

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 통과 조건: 본문에 "핑거"가 있고, 포함 키워드 중 하나 이상이 있으며, 제외 키워드가 없다.
 * 공식 표기((주)핑거, ㈜핑거, 주식회사 핑거, 핑거(163730))가 있으면 제외 키워드와 무관하게 통과.
 */
export function isRelevant(
  title: string,
  summary: string,
  include: string[] = DEFAULT_INCLUDE,
  exclude: string[] = DEFAULT_EXCLUDE,
): FilterResult {
  const text = norm(`${title} ${summary}`);
  const lower = text.toLowerCase();
  if (!text.includes('핑거')) return { pass: false, reason: '핑거 없음' };

  const official = /\(주\)\s*핑거|㈜\s*핑거|주식회사\s*핑거|핑거\s*\(\s*163730|핑거\s*\(\s*대표/.test(text);
  if (official) return { pass: true, reason: '공식 표기' };

  const ex = exclude.find((k) => lower.includes(k.toLowerCase()));
  if (ex) return { pass: false, reason: `제외: ${ex}` };

  const inc = include.find((k) => {
    // 짧은 영문 약어(CB, BW, IR)는 단어 경계로 검사
    if (/^[A-Za-z&]{2,4}$/.test(k)) return new RegExp(`(^|[^A-Za-z])${k.replace('&', '&')}([^A-Za-z]|$)`).test(text);
    return lower.includes(k.toLowerCase());
  });
  if (!inc) return { pass: false, reason: '관련 키워드 없음' };
  return { pass: true, reason: `포함: ${inc}` };
}
