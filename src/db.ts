import type { Env, IssueRow, ArticleRow } from './types.ts';

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

export async function getJsonSetting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const raw = await getSetting(env, key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function openIssues(env: Env, limit = 60): Promise<IssueRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM issues WHERE status != '완료'
     ORDER BY CASE severity WHEN '상' THEN 3 WHEN '중' THEN 2 WHEN '하' THEN 1 ELSE 0 END DESC, updated_at DESC
     LIMIT ?`
  ).bind(limit).all<IssueRow>();
  return results;
}

export async function existingUrlNorms(env: Env, norms: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < norms.length; i += 50) {
    const chunk = norms.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT url_norm FROM articles WHERE url_norm IN (${placeholders})`
    ).bind(...chunk).all<{ url_norm: string }>();
    for (const r of results) found.add(r.url_norm);
  }
  return found;
}

export async function recentTitleNorms(env: Env, days = 7): Promise<{ id: number; title_norm: string }[]> {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT id, title_norm FROM articles WHERE created_at >= ? OR published_at >= ?'
  ).bind(since, since).all<{ id: number; title_norm: string }>();
  return results;
}

export async function insertArticle(env: Env, a: Omit<ArticleRow, 'id' | 'created_at'>): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO articles (url, url_norm, title, title_norm, summary, publisher, published_at, source,
       tone, tone_by, severity, severity_code, confidence, ai_summary, evidence, issue_id, legacy_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    a.url, a.url_norm, a.title, a.title_norm, a.summary, a.publisher, a.published_at, a.source,
    a.tone, a.tone_by, a.severity, a.severity_code, a.confidence, a.ai_summary, a.evidence, a.issue_id, a.legacy_id
  ).run();
  return Number(res.meta.last_row_id);
}

export async function insertIssue(env: Env, i: {
  title: string; summary: string; severity: string; severity_code: string | null; severity_ai?: string | null;
  status?: string; suggested_action: string; media: string; legacy_id?: string | null; memo?: string;
  created_at?: string; updated_at?: string;
}): Promise<number> {
  const ts = nowIso();
  const res = await env.DB.prepare(
    `INSERT INTO issues (title, summary, severity, severity_code, severity_ai, status, suggested_action, memo, media, legacy_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    i.title, i.summary, i.severity, i.severity_code, i.severity_ai ?? i.severity, i.status ?? '신규',
    i.suggested_action, i.memo ?? '', i.media, i.legacy_id ?? null, i.created_at ?? ts, i.updated_at ?? ts
  ).run();
  return Number(res.meta.last_row_id);
}
