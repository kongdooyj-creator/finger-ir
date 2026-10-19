import type { Classification, Env, Severity, Tone } from './types.ts';
import { SEVERITIES, TONES } from './types.ts';
import { askJson } from './ai.ts';

export const CRITERIA_VERSION = 'IR-2026-10-14-v1';

export const CRITERIA_SYSTEM_PROMPT = `당신은 (주)핑거(코스닥 163730, 핀테크·ERP 기업)의 IR 담당자를 돕는 기사 분류기입니다.
기사 제목과 요약만 보고 아래 기준(${CRITERIA_VERSION})으로 판정합니다. 본문은 주어지지 않습니다.

[심각도] 회사가 확인·설명해야 할 영향의 크기. 논조와 독립.
- 상: (H1) 경영권·최대주주 변경 / (H2) 최근 자산 또는 자본의 20% 이상 거래·조달·손실, 또는 10% 이상 잠재 희석이 수치로 확인 / (H3) 상장폐지·부실·중대 제재·대규모 장애가 핑거와 명시적으로 연결. 규모가 크다는 이유만으로 '상' 아님.
- 중: (M1) 대금·계약 종결·인허가·정산 등 사업 실행 조건 / (M2) 사실 확인 중인 매각설·의혹 / (M3) 경영권 변동 없는 지분 변화.
- 하: (L1) 제품 소개·수상·교육·일반 MOU 등 재무·규제 리스크 신호 없음.
- 확인 필요: 근거 부족, 분모·회사 관련성 불명확, 출처 충돌. '하'로 취급하지 않음.

[논조]
- 우호: 제목·핵심 논지가 실적·경쟁력·성장을 명시적으로 긍정 평가. 회사 기대를 단순 전달하면 자동 우호 아님.
- 중립: 공시·수치·거래 조건 전달, 또는 긍정·리스크 균형. 희석·감자도 사실 전달이면 중립.
- 공격: 비판·우려·손실·희석·불확실성이 기사의 핵심.
- 미분류: 자료가 짧거나 핵심 논지 불명확. 중립을 기본값으로 쓰지 않음.

[규칙]
- 심각도와 논조는 독립 판정. 우호 기사도 심각도 상 가능.
- 20%·10% 기준은 분모가 없으면 비율을 추정하지 않음.
- 기사가 핑거와 무관하거나 핑거가 단순 언급이면 심각도 '확인 필요'.
- confidence는 판정 근거 문구가 입력에 실제로 있는지에 대한 자체 충분도(0~1). 근거 문구가 없으면 0.5 이하.

반드시 아래 JSON 한 개만 출력합니다. 다른 설명은 쓰지 않습니다.
{"tone":"우호|중립|공격|미분류","severity":"상|중|하|확인 필요","severity_code":"H1|H2|H3|M1|M2|M3|L1|null","confidence":0.0,"summary":"한국어 한 문장 요약","evidence":"판단 근거가 된 문구"}`;

const TONE_NEG = ['우려', '논란', '의혹', '손실', '적자', '급락', '하락', '희석', '불확실', '비판', '제재', '상폐', '상장폐지', '횡령', '배임', '거래정지', '부실', '경고', '리스크', '소송', '압수수색', '실망'];
const TONE_POS = ['성장', '호조', '확대', '수주', '기대', '도약', '강화', '흑자', '급등', '수상', '선정', '최대 실적', '사상 최대', '자신감', '성공', '호평', '돌파'];
const TONE_NEU = ['공시', '계약', '결정', '발표', '체결', '취득', '양수', '인수', '유상증자', '전환사채', '지분', '납입'];

const SEV_HIGH = ['최대주주 변경', '경영권 이전', '경영권 변경', '상장폐지', '상폐', '회생', '감사의견 거절', '거래정지', '횡령', '배임', '중대 제재'];
const SEV_MID = ['유상증자', '유증', '전환사채', 'CB', 'BW', '신주인수권', '인수', '매각', '매각설', '양수', '지분', '투자', '계약', '납입', '종결', '인허가', '정산', '희석', '의혹'];
const SEV_LOW = ['수상', '출시', '교육', 'MOU', '협약', '도입', '선정', '시험', '세미나', '참가', '소개', '전시', '후원', '행사'];

function hit(text: string, words: string[]): string | null {
  for (const w of words) {
    if (/^[A-Za-z]{2,4}$/.test(w)) { if (new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`).test(text)) return w; }
    else if (text.includes(w)) return w;
  }
  return null;
}

/** AI 를 못 쓸 때의 키워드 규칙. 심각도는 '확인 필요'로 두고 추정치는 evidence 에만 남긴다. */
export function classifyByRule(title: string, summary: string): Classification {
  const text = `${title} ${summary}`;
  const neg = hit(title, TONE_NEG) ?? hit(text, TONE_NEG);
  const pos = hit(title, TONE_POS) ?? hit(text, TONE_POS);
  const neu = hit(text, TONE_NEU);
  let tone: Tone = '미분류';
  let toneWhy = '핵심 논지 불명확';
  if (neg && !pos) { tone = '공격'; toneWhy = `부정 키워드: ${neg}`; }
  else if (pos && !neg) { tone = '우호'; toneWhy = `긍정 키워드: ${pos}`; }
  else if (neu) { tone = '중립'; toneWhy = `사실 전달 키워드: ${neu}`; }

  const h = hit(text, SEV_HIGH), m = hit(text, SEV_MID), l = hit(text, SEV_LOW);
  const guess = h ? `상 (${h})` : m ? `중 (${m})` : l ? `하 (${l})` : '단서 없음';
  return {
    tone,
    severity: '확인 필요',
    severity_code: null,
    confidence: 0.5,
    summary: title,
    evidence: `규칙 분류 — 논조: ${toneWhy} / 심각도 추정: ${guess}`,
    by: 'rule',
  };
}

/** Workers AI 로 분류. 실패하면 규칙 분류. */
export async function classifyArticle(env: Env, title: string, summary: string, publisher: string): Promise<Classification> {
  const j = await askJson(env, [
    { role: 'system', content: CRITERIA_SYSTEM_PROMPT },
    { role: 'user', content: `매체: ${publisher || '미상'}\n제목: ${title}\n요약: ${summary || '(없음)'}` },
  ]);
  if (!j) return classifyByRule(title, summary);

  const tone = TONES.includes(j.tone as Tone) ? (j.tone as Tone) : '미분류';
  let severity = SEVERITIES.includes(j.severity as Severity) ? (j.severity as Severity) : '확인 필요';
  const conf = typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0;
  let code = typeof j.severity_code === 'string' && /^(H[123]|M[123]|L1)$/.test(j.severity_code) ? j.severity_code : null;
  if (severity !== '확인 필요' && conf < 0.9) severity = '확인 필요'; // 충분도 0.9 미만이면 자동 등급 미확정
  if (severity === '확인 필요') code = null;
  return {
    tone,
    severity,
    severity_code: code,
    confidence: conf,
    summary: typeof j.summary === 'string' ? j.summary.slice(0, 300) : title,
    evidence: `[${j.__model}] ${typeof j.evidence === 'string' ? j.evidence.slice(0, 300) : ''}`.trim(),
    by: 'ai',
  };
}
