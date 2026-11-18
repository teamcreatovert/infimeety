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

  // Play, pause, seek and volume through the site's own player where it has one: YouTube and
  // Netflix override changes made straight to their video (a play is paused again at once).
  const control = (v) => {
    const n = netflix ? netflixPlayer() : null;
    const yt = document.getElementById('movie_player');
    const y = yt && typeof yt.playVideo === 'function' && yt.contains(v) ? yt : null;
    return {
      play: () => (n ? n.play() : y ? y.playVideo() : v.play().catch(() => {})),
      pause: () => (n ? n.pause() : y ? y.pauseVideo() : v.pause()),
      seek: (t) => (n ? n.seek(Math.round(t * 1000)) : y ? y.seekTo(t, true) : (v.currentTime = t)),
      volume: (by) => {
        if (y) {
          y.unMute();
          y.setVolume(Math.max(0, Math.min(100, y.getVolume() + by * 100)));
        } else if (n && n.setVolume) n.setVolume(Math.max(0, Math.min(1, n.getVolume() + by)));
        else (v.muted = false), (v.volume = Math.max(0, Math.min(1, v.volume + by)));
      },
      mute: () => (y ? (y.isMuted() ? y.unMute() : y.mute()) : n && n.setMuted ? n.setMuted(!n.isMuted()) : (v.muted = !v.muted)),
    };
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
  // A title that just loaded and starts by itself (Netflix after its Play button, YouTube's
  // autoplay) isn't anyone pressing play: it waits paused at the start for the room.
  let loadAt = 0;
  for (const e of ['loadstart', 'emptied']) document.addEventListener(e, () => (loadAt = Date.now()), true);
  const mark = () => {
    const now = Date.now();
    if (now - applying > 900 && now - gesture < 1500 && now - loadAt > 3000) userAt = now;
  };
  for (const e of ['play', 'pause', 'seeked']) document.addEventListener(e, mark, true);

  // Signals for the app, which can't hear keys in here: full screen on/off ("full"), leave it ("exit").
  let signal = { at: 0, kind: '' };
  const tell = (kind) => (signal = { at: Date.now(), kind });
  document.addEventListener('dblclick', () => tell('full'), true);

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
  // Netflix's watch page is the movie already (its subtitles and controls sit beside the video):
  // nothing to hide there, only the keys to take over.
  let netflixFill = false;
  const setFill = (on) => {
    if (netflix) return void (netflixFill = !!on);
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
  const filled = () => (netflix ? netflixFill : document.documentElement.classList.contains('infimeety-fill') && !!document.querySelector('[data-infimeety-player]'));

  // Infimeety's shortcuts, the same as its own player (YouTube's and VLC's, without clashes),
  // on the lobby's video-only screen. Elsewhere the site's own keys work as usual. On the window,
  // first of all (this runs before the site's scripts): the site's own handler for the same key
  // never also runs, or a press would count twice (play then pause, a skip of 20 s).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') return tell('exit');
      if (e.metaKey || e.altKey || !filled()) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const v = video();
      if (!v) return;
      const c = control(v);
      const go = (to) => c.seek(Math.max(0, Math.min(isFinite(v.duration) ? v.duration - 0.5 : to, to)));
      const k = e.key;
      const by = e.ctrlKey ? 60 : e.shiftKey ? 3 : 10;
      if (e.ctrlKey && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      if (k === ' ' || k === 'k' || k === 'K') {
        if (v.paused) c.play();
        else c.pause();
      } else if (k === 'ArrowLeft' || k === 'j' || k === 'J') go(v.currentTime - by);
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') go(v.currentTime + by);
      else if (k === 'ArrowUp') c.volume(0.05);
      else if (k === 'ArrowDown') c.volume(-0.05);
      else if (k === 'm' || k === 'M') c.mute();
      else if (k === 'f' || k === 'F') tell('full');
      else if (k === 'Home') go(0);
      else if (/^[0-9]$/.test(k) && isFinite(v.duration)) go((v.duration * Number(k)) / 10);
      else return;
      gesture = Date.now();
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // The rest of those presses (key up, typed character): the site mustn't act on them either
  // (YouTube toggles play on Space's key up too).
  const ours = /^( |k|K|j|J|l|L|m|M|f|F|[0-9]|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home)$/;
  for (const type of ['keyup', 'keypress'])
    window.addEventListener(
      type,
      (e) => {
        if (e.metaKey || e.altKey || !filled() || !ours.test(e.key)) return;
        const el = e.target;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );

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
      signal() {
        return [signal.at, signal.kind];
      },
      apply(cmd) {
        if (typeof cmd.fill === 'boolean') setFill(cmd.fill);
        const v = video();
        if (!v) return false;
        applying = Date.now();
        const c = control(v);
        if (typeof cmd.t === 'number' && Math.abs(v.currentTime - cmd.t) > (cmd.tol ?? 1)) c.seek(cmd.t);
        if (cmd.p === true && v.paused) c.play();
        else if (cmd.p === false && !v.paused) c.pause();
        return true;
      },
    }),
  });
})();
