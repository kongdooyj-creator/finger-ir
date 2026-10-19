import type { ArticleRow, Env, IssueRow } from './types.ts';
import { SEVERITIES, STATUSES, TONES } from './types.ts';
import { getSetting, nowIso } from './db.ts';
import { runPipeline } from './pipeline.ts';
import { importLegacy, type LegacyDump } from './legacy.ts';
import { CRITERIA_SYSTEM_PROMPT, CRITERIA_VERSION, classifyArticle } from './classify.ts';
import { runModel } from './ai.ts';

const PAGE = 10;

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function isAdmin(req: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const h = req.headers.get('authorization') || '';
  return h === `Bearer ${env.ADMIN_TOKEN}`;
}

const SEV_ORDER = `CASE severity WHEN '상' THEN 3 WHEN '중' THEN 2 WHEN '하' THEN 1 ELSE 0 END`;

async function dashboard(env: Env): Promise<Response> {
  const [counts, topIssues, recent, contracts, lastRun] = await Promise.all([
    env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM issues WHERE status != '완료') AS open_issues,
        (SELECT COUNT(*) FROM issues WHERE status != '완료' AND severity = '상') AS open_high,
        (SELECT COUNT(*) FROM issues) AS total_issues,
        (SELECT COUNT(*) FROM articles) AS total_articles,
        (SELECT COUNT(*) FROM articles WHERE date(COALESCE(published_at, created_at), '+9 hours') = date('now', '+9 hours')) AS today_articles,
        (SELECT COUNT(*) FROM media_contracts) AS contracts`).first<Record<string, number>>(),
    env.DB.prepare(`SELECT * FROM issues WHERE status != '완료' ORDER BY ${SEV_ORDER} DESC, updated_at DESC LIMIT 4`).all<IssueRow>(),
    env.DB.prepare(`SELECT * FROM articles ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 4`).all<ArticleRow>(),
    env.DB.prepare(`SELECT publisher, relation, status, note FROM media_contracts ORDER BY id`).all(),
    env.DB.prepare(`SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 1`).first(),
  ]);
  return json({
    as_of: nowIso(),
    last_checked: await getSetting(env, 'last_checked'),
    criteria_version: CRITERIA_VERSION,
    counts,
    top_issues: topIssues.results,
    recent_articles: recent.results,
    contracts: contracts.results,
    last_run: lastRun,
  });
}

async function listIssues(env: Env, url: URL): Promise<Response> {
  const sev = url.searchParams.get('severity') || '';
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (sev === '미확인' || sev === '확인 필요') { where.push(`severity = '확인 필요'`); }
  else if (SEVERITIES.includes(sev as never)) { where.push('severity = ?'); binds.push(sev); }
  if (status === 'open') where.push(`status != '완료'`);
  else if (STATUSES.includes(status as never)) { where.push('status = ?'); binds.push(status); }
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR memo LIKE ? OR media LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [total, rows, summary] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM issues ${w}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT * FROM issues ${w} ORDER BY (status = '완료') ASC, ${SEV_ORDER} DESC, updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, PAGE, (page - 1) * PAGE).all<IssueRow>(),
    env.DB.prepare(`SELECT
        SUM(status != '완료') AS open, COUNT(*) AS total, SUM(status = '완료') AS done FROM issues`).first(),
  ]);
  return json({ total: total?.n ?? 0, page, page_size: PAGE, items: rows.results, summary, last_checked: await getSetting(env, 'last_checked') });
}

async function getIssue(env: Env, id: number): Promise<Response> {
  const issue = await env.DB.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first<IssueRow>();
  if (!issue) return json({ error: 'not found' }, 404);
  const { results } = await env.DB.prepare(
    'SELECT id, title, publisher, published_at, url, tone, severity, ai_summary, evidence FROM articles WHERE issue_id = ? ORDER BY COALESCE(published_at, created_at) DESC'
  ).bind(id).all();
  return json({ ...issue, articles: results });
}

async function patchIssue(req: Request, env: Env, id: number): Promise<Response> {
  if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
  const body = await req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const issue = await env.DB.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first<IssueRow>();
  if (!issue) return json({ error: 'not found' }, 404);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.severity === 'string' && SEVERITIES.includes(body.severity as never)) {
    sets.push('severity = ?', 'severity_manual = 1'); binds.push(body.severity);
  }
  if (typeof body.status === 'string' && STATUSES.includes(body.status as never)) { sets.push('status = ?'); binds.push(body.status); }
  if (typeof body.memo === 'string') { sets.push('memo = ?'); binds.push(body.memo.slice(0, 4000)); }
  if (typeof body.suggested_action === 'string') { sets.push('suggested_action = ?'); binds.push(body.suggested_action.slice(0, 200)); }
  if (typeof body.title === 'string' && body.title.trim()) { sets.push('title = ?'); binds.push(body.title.trim().slice(0, 100)); }
  if (!sets.length) return json({ error: 'nothing to update' }, 400);
  sets.push('updated_at = ?'); binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getIssue(env, id);
}

async function listArticles(env: Env, url: URL): Promise<Response> {
  const tone = url.searchParams.get('tone') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const today = url.searchParams.get('today') === '1';
  const issueId = parseInt(url.searchParams.get('issue') || '', 10);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const where: string[] = [];
  const binds: unknown[] = [];
  const kstDate = `date(COALESCE(a.published_at, a.created_at), '+9 hours')`;
  if (TONES.includes(tone as never)) { where.push('a.tone = ?'); binds.push(tone); }
  if (q) { where.push('(a.title LIKE ? OR a.summary LIKE ? OR a.publisher LIKE ? OR a.ai_summary LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push(`${kstDate} >= ?`); binds.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push(`${kstDate} <= ?`); binds.push(to); }
  if (today) where.push(`${kstDate} = date('now', '+9 hours')`);
  if (!Number.isNaN(issueId)) { where.push('a.issue_id = ?'); binds.push(issueId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [total, rows, summary] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM articles a ${w}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT a.*, i.title AS issue_title FROM articles a LEFT JOIN issues i ON i.id = a.issue_id ${w}
                    ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, PAGE, (page - 1) * PAGE).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total,
        SUM(date(COALESCE(published_at, created_at), '+9 hours') = date('now', '+9 hours')) AS today FROM articles`).first(),
  ]);
  return json({ total: total?.n ?? 0, page, page_size: PAGE, items: rows.results, summary, last_checked: await getSetting(env, 'last_checked') });
}

async function listRuns(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 20').all<Record<string, unknown>>();
  for (const r of results) {
    for (const k of ['feeds', 'errors']) { try { r[k] = JSON.parse(String(r[k] ?? '[]')); } catch { /* keep */ } }
  }
  return json({ items: results });
}

export async function handleApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method.toUpperCase();

  if (m === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/api/dashboard' && m === 'GET') return dashboard(env);
  if (path === '/api/issues' && m === 'GET') return listIssues(env, url);
  if (path === '/api/articles' && m === 'GET') return listArticles(env, url);
  if (path === '/api/runs' && m === 'GET') return listRuns(env);
  if (path === '/api/version' && m === 'GET') {
    return json({ version: '2.0.0', criteria: CRITERIA_VERSION, last_checked: await getSetting(env, 'last_checked'), now: nowIso() });
  }
  const issueMatch = path.match(/^\/api\/issues\/(\d+)$/);
  if (issueMatch) {
    const id = Number(issueMatch[1]);
    if (m === 'GET') return getIssue(env, id);
    if (m === 'PATCH') return patchIssue(req, env, id);
  }
  if (path === '/api/admin/check' && m === 'GET') return json({ ok: isAdmin(req, env) }, isAdmin(req, env) ? 200 : 401);
  if (path === '/api/fetch-now' && m === 'POST') {
    if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
    // 분류까지 1~2분 걸리므로 백그라운드로 돌리고 바로 응답한다
    if (url.searchParams.get('wait') === '1') return json(await runPipeline(env, 'manual'));
    ctx.waitUntil(runPipeline(env, 'manual').catch((e) => console.error('manual run failed', String(e))));
    return json({ started: true, message: '수집을 시작했습니다. 1~2분 뒤 새로고침하세요.' }, 202);
  }
  if (path === '/api/ai-test' && m === 'POST') {
    if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
    const body = await req.json<{ title?: string; summary?: string }>().catch(() => ({} as { title?: string; summary?: string }));
    const title = body.title || "핑거, 메가존클라우드 지분 1.21% 약 300억에 양수 결정";
    const out: Record<string, unknown> = {};
    for (const model of [env.AI_MODEL, env.AI_MODEL_FALLBACK]) {
      const t0 = Date.now();
      try {
        const text = await runModel(env, model, [{ role: 'system', content: CRITERIA_SYSTEM_PROMPT }, { role: 'user', content: `제목: ${title}\n요약: ${body.summary || '(없음)'}` }]);
        out[model] = { ms: Date.now() - t0, text: text.slice(0, 800) };
      } catch (e) { out[model] = { ms: Date.now() - t0, error: String(e) }; }
    }
    out.classified = await classifyArticle(env, title, body.summary || '', '테스트');
    return json(out);
  }
  if (path === '/api/import-legacy' && m === 'POST') {
    if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
    let dump: LegacyDump;
    try { dump = await req.json<LegacyDump>(); } catch { return json({ error: 'invalid json' }, 400); }
    return json(await importLegacy(env, dump));
  }
  return json({ error: 'not found' }, 404);
}
