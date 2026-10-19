import type { Env } from './types.ts';

/** 최근 AI 호출 오류 (실행 기록에 남기기 위해 모은다) */
export const aiErrors: string[] = [];

/** 모델 응답 텍스트에서 첫 JSON 객체를 꺼낸다 */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  // 중괄호 깊이를 세어 첫 완결 객체를 찾는다
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Workers AI 응답 형태가 모델마다 달라서 텍스트를 최대한 꺼낸다 */
export function responseText(res: unknown): string {
  if (typeof res === 'string') return res;
  if (!res || typeof res !== 'object') return '';
  const r = res as Record<string, any>;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const choice = r.choices?.[0];
  if (choice) {
    const content = choice.message?.content ?? choice.text;
    if (typeof content === 'string' && content.trim()) return content;
    if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join('');
  }
  if (Array.isArray(r.output)) {
    // OpenAI Responses 형식 (gpt-oss 등)
    const msg = r.output.find((o: any) => o?.type === 'message');
    const txt = msg?.content?.map((c: any) => c?.text ?? '').join('');
    if (txt) return txt;
  }
  if (typeof r.result?.response === 'string') return r.result.response;
  return '';
}

/** 한 번의 모델 호출 제한 시간. 넘으면 다음 모델(또는 규칙 분류)로 넘어간다 */
export const AI_TIMEOUT_MS = 25000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} ${ms / 1000}초 초과`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export async function runModel(env: Env, model: string, messages: { role: string; content: string }[]): Promise<string> {
  // 모델 id 는 설정값이라 리터럴 타입 대신 문자열로 호출한다
  const ai = env.AI as unknown as { run: (m: string, input: unknown) => Promise<unknown> };
  const res = await withTimeout(ai.run(model, { messages, max_tokens: 500, temperature: 0.1 }), AI_TIMEOUT_MS, model);
  const text = responseText(res);
  if (!text) throw new Error(`빈 응답: ${JSON.stringify(res).slice(0, 200)}`);
  return text;
}

/** 1순위 모델 → 폴백 모델 순으로 시도해 JSON 을 돌려준다. 모두 실패하면 null */
export async function askJson(env: Env, messages: { role: string; content: string }[]): Promise<Record<string, unknown> | null> {
  for (const model of [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter(Boolean)) {
    try {
      const text = await runModel(env, model, messages);
      const j = extractJson(text);
      if (j) { j.__model = model.split('/').pop(); return j; }
      aiErrors.push(`${model}: JSON 없음: ${text.slice(0, 120)}`);
    } catch (e) {
      aiErrors.push(`${model}: ${String(e).slice(0, 200)}`);
      console.warn('AI call failed', model, String(e));
    }
  }
  return null;
}
