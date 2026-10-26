// Download page: put this device's download first, show the latest version, and bring the
// page to life (scroll reveals, the watch party sync and copy demos).
(function () {
  var ua = navigator.userAgent;
  var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPads say "Macintosh"
  var ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  var android = /Android/.test(ua);
  var mac = /Macintosh/.test(ua) && !touchMac;
  var windows = /Windows/.test(ua);
  var platform = ios ? 'ios' : android ? 'android' : mac ? 'mac' : windows ? 'windows' : null;

  // Choosing the browser version remembers it (the home page then opens the app directly).
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-web]')) {
      try {
        localStorage.setItem('infimeety.web', '1');
      } catch (err) {}
    }
  });

  // The hero button and the highlighted card follow this device.
  var hero = document.getElementById('hero-download');
  var heroLabel = hero && hero.querySelector('span');
  var card = platform && document.getElementById(platform === 'windows' ? 'p-windows' : 'p-web');
  function signInIcon() {
    var icon = hero.querySelector('svg');
    if (icon) icon.innerHTML = '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" />';
  }
  if (card) card.classList.add('mine');
  if (hero && heroLabel) {
    if (platform === 'windows') {
      hero.href = document.getElementById('dl-windows').href;
      heroLabel.textContent = 'Download for Windows';
    } else if (platform) {
      // Only Windows has an app; Macs and phones use Infimeety in the browser.
      hero.href = '/web/';
      hero.setAttribute('data-web', '');
      heroLabel.textContent = 'Open Infimeety';
      signInIcon();
    }
  }

  // The latest version.
  fetch('https://api.github.com/repos/teamcreatovert/infimeety/releases/latest')
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (release) {
      if (!release) return;
      var version = String(release.tag_name || '').replace(/^v/, '');
      if (version) {
        var meta = document.getElementById('meta');
        if (meta) meta.textContent = 'Version ' + version + ' · Windows 10 or 11 · Every modern browser';
        var v = document.getElementById('version');
        if (v) v.insertBefore(document.createTextNode('Version ' + version + ' · '), v.firstChild);
      }
    })
    .catch(function () {});

  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fade sections in as they scroll into view.
  var reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || still) {
    reveals.forEach(function (el) {
      el.classList.add('in');
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          // Siblings that arrive together come in one after another.
          var delay = Array.prototype.indexOf.call(el.parentNode.children, el) % 4;
          el.style.transitionDelay = delay * 80 + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  }

  // Watch party demo: three players, one timeline.
  var bars = document.querySelectorAll('[data-sync]');
  var tcs = document.querySelectorAll('[data-tc]');
  var LENGTH = 2 * 3600 + 14 * 60; // a 2 h 14 min movie
  var start = performance.now();
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function timecode(s) {
    return Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(Math.floor(s % 60));
  }
  // Copy demo: a 2 GB movie at ~12 MB/s, looping.
  var copyBar = document.querySelector('[data-copy-bar]');
  var copySub = document.querySelector('[data-copy-sub]');
  var SIZE = 2.1;
  var copyStart = performance.now();

  function frame(now) {
    // The demo movie runs 40x faster than real time, from 1:43:00.
    var t = (6180 + ((now - start) / 1000) * 40) % LENGTH;
    for (var i = 0; i < bars.length; i++) bars[i].style.width = (t / LENGTH) * 100 + '%';
    for (var j = 0; j < tcs.length; j++) tcs[j].textContent = timecode(t);

    if (copyBar && copySub) {
      var elapsed = ((now - copyStart) / 1000) % 12; // 10 s to copy, 2 s to rest
      var done = Math.min(1, elapsed / 10);
      var speed = 11.4 + Math.sin(now / 700) * 1.3;
      copyBar.style.width = done * 100 + '%';
      copySub.textContent =
        done < 1
          ? Math.round(done * 100) + '% of ' + SIZE + ' GB · ' + speed.toFixed(1) + ' MB/s · ' + Math.max(1, Math.ceil((1 - done) * 180)) + ' s left'
          : 'Saved to Movies · ready to watch';
    }
    if (!still) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
