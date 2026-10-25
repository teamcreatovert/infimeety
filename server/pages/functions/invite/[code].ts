import { invitePreview, type Env } from '../../../src/util';

const DOWNLOAD_URL = 'https://github.com/teamcreatovert/infimeety/releases/latest/download/Infimeety-Setup.exe';
const COLORS: Record<string, [string, string]> = {
  blue: ['#5E9BFF', '#3D6BFF'],
  purple: ['#B57BFF', '#7B61FF'],
  pink: ['#FF7AA2', '#FF4F8B'],
  orange: ['#FFB547', '#FF7A3D'],
  green: ['#4CD964', '#2BB673'],
  teal: ['#5AD8E6', '#2A9BD7'],
  graphite: ['#8E8E93', '#5A5A60'],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** https://infimeety.pages.dev/invite/CODE: preview the channel and open it in the app. */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const preview = await invitePreview(ctx.env, String(ctx.params.code ?? ''));
  const [a, b] = COLORS[preview?.color ?? 'blue'] ?? COLORS.blue;
  const title = preview ? `Join ${preview.name} on Infimeety` : 'Invite not found';

  const body = preview
    ? `<div class="tile" style="background:linear-gradient(145deg,${a},${b})">${esc(preview.emoji)}</div>
       <p class="eyebrow">You've been invited to join</p>
       <h1>${esc(preview.name)}</h1>
       <p class="meta">${preview.members} ${preview.members === 1 ? 'member' : 'members'}</p>
       <a class="button" href="infimeety://invite/${preview.code}">Open in Infimeety</a>
       <p class="code">Or join from the app with code <b>${preview.code}</b></p>
       <a class="secondary" href="${DOWNLOAD_URL}">Don't have Infimeety? Download for Windows</a>`
    : `<div class="tile" style="background:linear-gradient(145deg,#8E8E93,#5A5A60)">🔗</div>
       <h1>This invite doesn't work</h1>
       <p class="meta">It may have expired, or the code was reset. Ask your friend for a new link.</p>
       <a class="secondary" href="/">Go to Infimeety</a>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Voice rooms, chat and watch-together. No time limits.">
<link rel="icon" type="image/png" href="/icon.png"><style>
:root{--bg:#08080c;--fg:rgba(255,255,255,.94);--fg2:rgba(235,235,245,.64);--fg3:rgba(235,235,245,.4);--glass:rgba(30,30,40,.55);--hair:rgba(255,255,255,.12);color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#e9ebf1;--fg:rgba(0,0,0,.88);--fg2:rgba(60,60,67,.72);--fg3:rgba(60,60,67,.45);--glass:rgba(255,255,255,.6);--hair:rgba(0,0,0,.08);color-scheme:light}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Inter','Segoe UI Variable Display',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wall{position:fixed;inset:0;z-index:-1;overflow:hidden}.wall span{position:absolute;border-radius:50%;filter:blur(110px);opacity:.5}
.wall span:nth-child(1){width:62vw;height:62vw;left:-14vw;top:-26vw;background:${a}}.wall span:nth-child(2){width:54vw;height:54vw;right:-16vw;bottom:-24vw;background:#8f3dff}
.card{width:100%;max-width:400px;padding:36px 30px 28px;border-radius:32px;text-align:center;background:var(--glass);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);box-shadow:0 0 0 .5px var(--hair),0 30px 80px rgba(0,0,0,.35)}
.tile{width:84px;height:84px;margin:0 auto;border-radius:26px;display:grid;place-items:center;font-size:42px;box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 14px 34px rgba(0,0,0,.3)}
.eyebrow{margin:20px 0 2px;font-size:13px;color:var(--fg2)}h1{margin:4px 0 4px;font-size:28px;font-weight:700;letter-spacing:-.03em}
.meta{margin:0;color:var(--fg2);font-size:14px;line-height:1.5}
.button{display:flex;align-items:center;justify-content:center;margin-top:24px;height:46px;border-radius:13px;background:#0a84ff;color:#fff;font-size:15px;font-weight:600;text-decoration:none;box-shadow:inset 0 .5px 0 rgba(255,255,255,.35)}
.button:hover{filter:brightness(1.1)}.code{margin:14px 0 0;font-size:12.5px;color:var(--fg3)}.code b{font-family:ui-monospace,Consolas,monospace;letter-spacing:.12em;color:var(--fg2)}
.secondary{display:inline-block;margin-top:18px;font-size:13px;color:#0a84ff;text-decoration:none}.secondary:hover{text-decoration:underline}
</style></head><body><div class="wall" aria-hidden="true"><span></span><span></span></div><main class="card">${body}</main></body></html>`;

  return new Response(html, { status: preview ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
