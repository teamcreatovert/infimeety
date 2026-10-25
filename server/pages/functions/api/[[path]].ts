import app from '../../../src/app';
import type { Env } from '../../../src/util';

/** Everything under /api goes to the shared API, with the /api prefix removed. */
export const onRequest: PagesFunction<Env> = (ctx) => {
  const url = new URL(ctx.request.url);
  url.pathname = url.pathname.slice('/api'.length) || '/';
  return app.fetch(new Request(url, ctx.request), ctx.env, ctx as unknown as ExecutionContext);
};
