import type { Env } from './types.ts';
import { handleApi, json } from './api.ts';
import { runPipeline } from './pipeline.ts';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, ctx);
      } catch (e) {
        console.error('api error', String(e));
        return json({ error: 'internal', detail: String(e) }, 500);
      }
    }
    // 그 외는 정적 자산(public/). 해시 라우팅이라 / 만 있으면 된다.
    return env.ASSETS.fetch(req);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runPipeline(env, 'cron')
        .then((s) => console.log('cron ok', JSON.stringify({ id: s.id, candidates: s.candidates, imported: s.imported, filtered: s.filtered, duplicates: s.duplicates, errors: s.errors.length })))
        .catch((e) => console.error('cron failed', String(e))),
    );
    void event;
  },
} satisfies ExportedHandler<Env>;
