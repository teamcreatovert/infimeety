import { COLORS, DOWNLOAD_URL, esc, landingPage } from '../../src/landing';
import { MEETING_CODE, meetingPreview } from '../../src/meetings';
import type { Env } from '../../src/util';

const VIDEO_ICON = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2.5"/></svg>`;

/**
 * https://infimeety.pages.dev/gyus-768g-hsf: a quick meeting's link. Opens it in the app, or in the
 * browser as a guest. Any other single-segment path (e.g. /icon.png) falls through to the static site.
 */
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const code = String(ctx.params.code ?? '');
  if (!MEETING_CODE.test(code)) return ctx.next();

  const preview = await meetingPreview(ctx.env, code);
  const [a, b] = COLORS.teal;
  if (!preview) {
    return landingPage({
      title: 'This meeting has ended',
      description: 'Quick meetings on Infimeety close after a day, or once nobody has been in them for an hour.',
      glow: COLORS.graphite[0],
      status: 404,
      body: `<div class="tile" style="background:linear-gradient(145deg,${COLORS.graphite.join(',')})">${VIDEO_ICON}</div>
        <h1>This meeting has ended</h1>
        <p class="meta">Quick meetings close a day after they start, or once nobody has been in them for an hour. Ask for a new link.</p>
        <a class="secondary" href="/">Go to Infimeety</a>`,
    });
  }

  const who =
    preview.inCall === 0
      ? 'Nobody’s in the call yet'
      : `<span class="live">${preview.inCall} ${preview.inCall === 1 ? 'person is' : 'people are'} in the call</span>`;
  return landingPage({
    title: `Join ${preview.name} on Infimeety`,
    description: `${preview.host.name} invited you to a meeting: voice, video and screen sharing.`,
    glow: a,
    body: `<div class="tile" style="background:linear-gradient(145deg,${a},${b})">${VIDEO_ICON}</div>
      <p class="eyebrow">You’re invited to a meeting</p>
      <h1>${esc(preview.name)}</h1>
      <p class="meta">${who}</p>
      <a class="button" href="infimeety://meet/${preview.code}">Open in Infimeety</a>
      <a class="button glass" href="/web/?meet=${preview.code}">Join in your browser</a>
      <p class="code">Meeting code <b>${preview.code}</b></p>
      <a class="secondary" href="${DOWNLOAD_URL}">Don't have Infimeety? Download for Windows</a>`,
  });
};
