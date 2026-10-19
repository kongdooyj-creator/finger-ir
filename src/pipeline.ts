import type { Candidate, Env, FeedResult, Severity } from './types.ts';
import { DEFAULT_FEEDS, fetchFeed, type Feed } from './sources/rss.ts';
import { DEFAULT_NAVER_QUERIES, fetchNaver } from './sources/naver.ts';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, isRelevant } from './filter.ts';
import { isSameTitle, normalizeTitle, normalizeUrl } from './dedupe.ts';
import { classifyArticle } from './classify.ts';
import { aiErrors } from './ai.ts';
import { linkArticleToIssue } from './issues.ts';
import { existingUrlNorms, getJsonSetting, insertArticle, nowIso, recentTitleNorms, setSetting } from './db.ts';

export interface RunSummary {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string;
  candidates: number;
  filtered: number;
  duplicates: number;
  imported: number;
  classified: number;
  feeds: FeedResult[];
  errors: string[];
}

/** 2시간마다(또는 수동으로) 실행되는 수집 → 필터 → 중복 제거 → 분류 → 이슈 연결 파이프라인 */
export async function runPipeline(env: Env, trigger: 'cron' | 'manual'): Promise<RunSummary> {
  const started = nowIso();
  const runIns = await env.DB.prepare('INSERT INTO fetch_runs (trigger, started_at) VALUES (?, ?)').bind(trigger, started).run();
  const runId = Number(runIns.meta.last_row_id);
  const errors: string[] = [];
  const feeds: FeedResult[] = [];
  let candidates: Candidate[] = [];

  // 1. 수집 (병렬, 한 피드 실패해도 계속)
  const feedList = await getJsonSetting<Feed[]>(env, 'feeds', DEFAULT_FEEDS);
  const naverQueries = await getJsonSetting<string[]>(env, 'naver_queries', DEFAULT_NAVER_QUERIES);
  const [rssResults, naver] = await Promise.all([
    Promise.all(feedList.map((f) => fetchFeed(f))),
    fetchNaver(env, naverQueries),
  ]);
  for (const r of rssResults) { feeds.push(r.result); candidates.push(...r.items); }
  feeds.push(...naver.results);
  candidates.push(...naver.items);
  const candidateCount = candidates.length;

  // 2. 오탐 필터
  const include = await getJsonSetting<string[]>(env, 'include_keywords', DEFAULT_INCLUDE);
  const exclude = await getJsonSetting<string[]>(env, 'exclude_keywords', DEFAULT_EXCLUDE);
  const relevant = candidates.filter((c) => isRelevant(c.title, c.summary, include, exclude).pass);
  const filtered = candidateCount - relevant.length;

  // 3. 중복 제거 (배치 내부 + DB)
  const seenUrl = new Set<string>();
  const batch: (Candidate & { url_norm: string; title_norm: string })[] = [];
  for (const c of relevant) {
    const url_norm = normalizeUrl(c.url);
    if (seenUrl.has(url_norm)) continue;
    const title_norm = normalizeTitle(c.title);
    if (batch.some((b) => isSameTitle(b.title_norm, title_norm))) continue;
    seenUrl.add(url_norm);
    batch.push({ ...c, url_norm, title_norm });
  }
  const dbUrls = await existingUrlNorms(env, batch.map((b) => b.url_norm));
  const dbTitles = await recentTitleNorms(env, 7);
  const fresh = batch.filter((b) => !dbUrls.has(b.url_norm) && !dbTitles.some((t) => isSameTitle(t.title_norm, b.title_norm)));
  const duplicates = relevant.length - fresh.length;

  // 4. 분류 + 저장 (실행당 상한, 초과분은 다음 실행에서 새 기사로 다시 잡힘)
  const max = Math.max(1, parseInt(env.MAX_CLASSIFY_PER_RUN || '20', 10) || 20);
  fresh.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  let imported = 0, classified = 0;
  const deadline = Date.now() + 8 * 60 * 1000; // 크론 실행 제한(15분) 안에서 끝내기 위한 여유
  for (const c of fresh.slice(0, max)) {
    if (Date.now() > deadline) { errors.push('시간 제한: 남은 기사는 다음 실행에서 처리'); break; }
    try {
      const cls = await classifyArticle(env, c.title, c.summary, c.publisher);
      if (cls.by === 'ai') classified++;
      let issueId: number | null = null;
      if (cls.severity === '중' || cls.severity === '상') {
        try {
          issueId = await linkArticleToIssue(env, {
            title: c.title, summary: cls.summary || c.summary, publisher: c.publisher,
            severity: cls.severity as Severity, severity_code: cls.severity_code,
          });
        } catch (e) { errors.push(`issue link: ${c.url}: ${String(e)}`); }
      }
      await insertArticle(env, {
        url: c.url, url_norm: c.url_norm, title: c.title, title_norm: c.title_norm, summary: c.summary,
        publisher: c.publisher, published_at: c.publishedAt ?? started, source: c.source,
        tone: cls.tone, tone_by: cls.by, severity: cls.severity, severity_code: cls.severity_code,
        confidence: cls.confidence, ai_summary: cls.summary, evidence: cls.evidence, issue_id: issueId, legacy_id: null,
      });
      imported++;
    } catch (e) {
      errors.push(`insert: ${c.url}: ${String(e)}`);
    }
  }
  if (fresh.length > max) errors.push(`상한 초과: ${fresh.length - max}건은 다음 실행에서 처리`);
  if (aiErrors.length) {
    errors.push(...[...new Set(aiErrors)].slice(0, 5).map((e) => `AI: ${e}`));
    aiErrors.length = 0;
  }

  // 5. 실행 기록
  const finished = nowIso();
  await env.DB.prepare(
    `UPDATE fetch_runs SET finished_at=?, candidates=?, filtered=?, duplicates=?, imported=?, classified=?, feeds=?, errors=? WHERE id=?`
  ).bind(finished, candidateCount, filtered, duplicates, imported, classified, JSON.stringify(feeds), JSON.stringify(errors), runId).run();
  await setSetting(env, 'last_checked', finished);

  return { id: runId, trigger, started_at: started, finished_at: finished, candidates: candidateCount, filtered, duplicates, imported, classified, feeds, errors };
}
