import { COLORS, DOWNLOAD_URL, esc, landingPage } from '../../../src/landing';
import { invitePreview, type Env } from '../../../src/util';

/** https://infimeety.pages.dev/invite/CODE: preview the channel and open it in the app. */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const preview = await invitePreview(ctx.env, String(ctx.params.code ?? ''));
  const [a, b] = COLORS[preview?.color ?? 'blue'] ?? COLORS.blue;

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

  return landingPage({
    title: preview ? `Join ${preview.name} on Infimeety` : 'Invite not found',
    description: 'Voice rooms, chat and watch-together. No time limits.',
    glow: a,
    body,
    status: preview ? 200 : 404,
  });
};
