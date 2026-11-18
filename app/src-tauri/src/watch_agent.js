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

  // Video only (the watch party lobby's screen): the site's own player fills the page, its
  // controls included; everything else on the page steps aside.
  const FILL_CSS =
    'html.infimeety-fill,html.infimeety-fill body{overflow:hidden!important}' +
    'html.infimeety-fill [data-infimeety-player]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;z-index:2147483646!important;background:#000!important}' +
    'html.infimeety-fill [data-infimeety-player] video{object-fit:contain!important}' +
    // Its wrappers can trap a fixed element (transforms, containment, stacking): loosen them.
    'html.infimeety-fill [data-infimeety-chain]{transform:none!important;contain:none!important;filter:none!important;will-change:auto!important;z-index:auto!important;overflow:visible!important}' +
    'html.infimeety-fill #masthead-container,html.infimeety-fill ytd-masthead{display:none!important}' +
    // Everything but the player is hidden (the player keeps its own controls).
    'html.infimeety-fill body *{visibility:hidden!important}' +
    'html.infimeety-fill [data-infimeety-player],html.infimeety-fill [data-infimeety-player] *{visibility:visible!important}';
  const playerOf = (v) => {
    const yt = v.closest('#movie_player, .html5-video-player');
    if (yt) return yt;
    // Elsewhere: the video's wrapper while it's about the video's size (the player, not the page).
    let el = v;
    const vr = v.getBoundingClientRect();
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      const r = el.parentElement.getBoundingClientRect();
      if (r.width > vr.width * 1.25 || r.height > vr.height * 1.4) break;
      el = el.parentElement;
    }
    return el;
  };
  const setFill = (on) => {
    if (!document.getElementById('infimeety-fill-style')) {
      const style = document.createElement('style');
      style.id = 'infimeety-fill-style';
      style.textContent = FILL_CSS;
      (document.head || document.documentElement).appendChild(style);
    }
    for (const el of document.querySelectorAll('[data-infimeety-player],[data-infimeety-chain]')) el.removeAttribute(el.hasAttribute('data-infimeety-player') ? 'data-infimeety-player' : 'data-infimeety-chain');
    for (const el of document.querySelectorAll('[data-infimeety-chain]')) el.removeAttribute('data-infimeety-chain');
    const v = on ? video() : null;
    if (v) {
      const player = playerOf(v);
      player.setAttribute('data-infimeety-player', '');
      for (let el = player.parentElement; el && el !== document.documentElement; el = el.parentElement) el.setAttribute('data-infimeety-chain', '');
    }
    document.documentElement.classList.toggle('infimeety-fill', !!v);
    // Players lay themselves out again on a resize.
    window.dispatchEvent(new Event('resize'));
  };
  const filled = () => document.documentElement.classList.contains('infimeety-fill') && !!document.querySelector('[data-infimeety-player]');

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
          filled: filled(),
        };
      },
      apply(cmd) {
        if (typeof cmd.fill === 'boolean') setFill(cmd.fill);
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
