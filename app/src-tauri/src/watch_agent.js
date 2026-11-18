// Runs in every page of the Infimeety browser window (watching a website together). It only
// reports the page's main video (time, playing, ads) when the app asks, and plays, pauses or
// seeks it when told. It sends nothing anywhere and reads nothing else from the page.
(() => {
  if (window.top !== window || window.__infimeetySync) return;
  const netflix = /(^|\.)netflix\.com$/.test(location.hostname);

  // Netflix's own player: seeking its video element directly makes it show an error.
  const netflixPlayer = () => {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = api.getAllPlayerSessionIds();
      const id = ids.find((s) => s.startsWith('watch')) || ids[0];
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  };

  // The biggest video on the page that has something loaded: the movie, not a preview tile.
  const video = () => {
    let best = null;
    let area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const a = r.width * r.height;
      if (v.readyState > 0 && a > area) {
        best = v;
        area = a;
      }
    }
    return best;
  };

  // YouTube marks its player while an ad plays.
  const adShowing = () => !!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');

  // Play, pause and seek the person did themselves, so the app can share them: right after a
  // click or key in the page (not the site's own autoplay, and not the app's doing).
  let applying = 0;
  let userAt = 0;
  let gesture = 0;
  for (const e of ['pointerdown', 'keydown']) document.addEventListener(e, () => (gesture = Date.now()), true);
  const mark = () => {
    const now = Date.now();
    if (now - applying > 900 && now - gesture < 1500) userAt = now;
  };
  for (const e of ['play', 'pause', 'seeked']) document.addEventListener(e, mark, true);

  const signinPage = () => /(^|[/.?=&-])(login|signin|sign-in|sign_in|auth)([/.?=&-]|$)/i.test(location.pathname + location.search) || /^accounts\./.test(location.hostname);

  Object.defineProperty(window, '__infimeetySync', {
    value: Object.freeze({
      state() {
        const v = video();
        return {
          url: location.href,
          title: document.title,
          signin: signinPage(),
          video: v ? { t: v.currentTime, d: isFinite(v.duration) ? v.duration : 0, p: !v.paused && !v.ended, r: v.readyState, ad: adShowing() } : null,
          userAt,
        };
      },
      apply(cmd) {
        const v = video();
        if (!v) return false;
        applying = Date.now();
        const n = netflix ? netflixPlayer() : null;
        if (typeof cmd.t === 'number' && Math.abs(v.currentTime - cmd.t) > (cmd.tol ?? 1)) {
          if (n) n.seek(Math.round(cmd.t * 1000));
          else v.currentTime = cmd.t;
        }
        if (cmd.p === true && v.paused) {
          if (n) n.play();
          else v.play().catch(() => {});
        } else if (cmd.p === false && !v.paused) {
          if (n) n.pause();
          else v.pause();
        }
        return true;
      },
    }),
  });
})();
