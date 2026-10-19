import type { Env } from './types.ts';
import { handleApi, json } from './api.ts';
import { runPipeline } from './pipeline.ts';
import { PgDatabase } from './pg.ts';

/** DATABASE_URL(Neon) 이 설정돼 있으면 DB 를 Postgres 로 바꾸고, 원래 D1 은 env.D1 로 남겨 둔다 */
function withDb(env: Env): Env {
  if (!env.DATABASE_URL) return env;
  return { ...env, D1: env.DB, DB: new PgDatabase(env.DATABASE_URL) as unknown as D1Database };
}

export default {
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, withDb(rawEnv), ctx);
      } catch (e) {
        console.error('api error', String(e));
        return json({ error: 'internal', detail: String(e) }, 500);
      }
    }
    // 그 외는 정적 자산(public/). 해시 라우팅이라 / 만 있으면 된다.
    return rawEnv.ASSETS.fetch(req);
  },

  async scheduled(event: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    const env = withDb(rawEnv);
    ctx.waitUntil(
      runPipeline(env, 'cron')
        .then((s) => console.log('cron ok', JSON.stringify({ id: s.id, candidates: s.candidates, imported: s.imported, filtered: s.filtered, duplicates: s.duplicates, errors: s.errors.length })))
        .catch((e) => console.error('cron failed', String(e))),
    );
    void event;
  },
} satisfies ExportedHandler<Env>;
