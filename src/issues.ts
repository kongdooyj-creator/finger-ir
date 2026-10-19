import type { Env, IssueRow, Severity } from './types.ts';
import { SEVERITY_RANK } from './types.ts';
import { askJson } from './ai.ts';
import { insertIssue, nowIso, openIssues } from './db.ts';
import { normalizeTitle, titleSimilarity } from './dedupe.ts';

export interface IssueMatch {
  issue_id: number | null;
  new_issue_title: string | null;
  new_issue_summary: string | null;
  suggested_action: string | null;
}

async function matchWithAi(
  env: Env,
  article: { title: string; summary: string; severity: string },
  issues: IssueRow[],
): Promise<IssueMatch | null> {
  const list = issues.map((i) => `- id ${i.id}: ${i.title} — ${(i.summary || '').slice(0, 80)}`).join('\n') || '(없음)';
  const j = await askJson(env, [
    { role: 'system', content: `당신은 (주)핑거 IR 이슈 관리 보조입니다. 새 기사가 기존 미해결 이슈와 "명확히 같은 사건"이면 그 id를, 아니면 issue_id를 null로 두고 새 이슈 제목(20자 내), 요약(60자 내), 대응 방향 제안("제안: …" 형식, 15자 내)을 씁니다. JSON 한 개만 출력합니다.
{"issue_id":number|null,"new_issue_title":string|null,"new_issue_summary":string|null,"suggested_action":string|null}` },
    { role: 'user', content: `[기존 미해결 이슈]\n${list}\n\n[새 기사] 심각도 ${article.severity}\n제목: ${article.title}\n요약: ${article.summary}` },
  ]);
  if (!j) return null;
  const id = typeof j.issue_id === 'number' && issues.some((i) => i.id === j.issue_id) ? j.issue_id : null;
  return {
    issue_id: id,
    new_issue_title: typeof j.new_issue_title === 'string' ? j.new_issue_title.slice(0, 40) : null,
    new_issue_summary: typeof j.new_issue_summary === 'string' ? j.new_issue_summary.slice(0, 200) : null,
    suggested_action: typeof j.suggested_action === 'string' ? j.suggested_action.slice(0, 60) : null,
  };
}

function matchByTitle(title: string, issues: IssueRow[]): number | null {
  const t = normalizeTitle(title);
  let best: { id: number; score: number } | null = null;
  for (const i of issues) {
    const s = titleSimilarity(t, normalizeTitle(i.title));
    if (s >= 0.5 && (!best || s > best.score)) best = { id: i.id, score: s };
  }
  return best?.id ?? null;
}

function addMedia(existing: string, publisher: string): string {
  if (!publisher) return existing;
  const parts = existing ? existing.split('·').map((s) => s.trim()).filter(Boolean) : [];
  if (!parts.includes(publisher)) parts.push(publisher);
  return parts.slice(0, 6).join('·');
}

/**
 * 심각도 중·상 기사를 기존 이슈에 연결하거나 새 이슈를 만든다.
 * - 수동 설정(severity_manual=1)된 이슈의 심각도는 바꾸지 않고 severity_ai 만 갱신
 * - 자동 하향 없음. 새 근거가 더 심각할 때만 상향
 * 반환: 연결된 issue id
 */
export async function linkArticleToIssue(
  env: Env,
  article: { title: string; summary: string; publisher: string; severity: Severity; severity_code: string | null },
): Promise<number> {
  const issues = await openIssues(env);
  const ai = await matchWithAi(env, article, issues);
  const matchedId = ai?.issue_id ?? matchByTitle(article.title, issues);

  if (matchedId) {
    const issue = issues.find((i) => i.id === matchedId)!;
    const upgrade = SEVERITY_RANK[article.severity] > SEVERITY_RANK[issue.severity];
    const newSeverity = upgrade && !issue.severity_manual ? article.severity : issue.severity;
    const newCode = upgrade && !issue.severity_manual ? article.severity_code : issue.severity_code;
    await env.DB.prepare(
      `UPDATE issues SET severity = ?, severity_code = ?, severity_ai = ?, media = ?, updated_at = ? WHERE id = ?`
    ).bind(
      newSeverity, newCode,
      upgrade ? article.severity : issue.severity_ai ?? issue.severity,
      addMedia(issue.media, article.publisher), nowIso(), issue.id,
    ).run();
    return issue.id;
  }

  const title = ai?.new_issue_title || article.title.slice(0, 30);
  return insertIssue(env, {
    title,
    summary: ai?.new_issue_summary || article.summary.slice(0, 120) || article.title,
    severity: article.severity,
    severity_code: article.severity_code,
    severity_ai: article.severity,
    suggested_action: ai?.suggested_action || '제안: 사실관계 확인',
    media: article.publisher,
  });
}
