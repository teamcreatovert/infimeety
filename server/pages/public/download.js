// Put this computer's download first, and say which version it is. If the latest release
// has no Mac build yet, say so instead of linking to a missing file.
(function () {
  var ua = navigator.userAgent;
  var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  var phone = /Android|iPhone|iPad|iPod|Mobile/.test(ua) || touchMac;
  var mac = /Macintosh/.test(ua) && !touchMac;
  var windows = mac || phone ? null : document.getElementById('windows');
  var first = mac ? document.getElementById('mac') : windows;
  if (first) {
    first.classList.add('primary');
    first.parentNode.insertBefore(first, first.parentNode.firstChild);
  }
  if (phone) {
    // Phones can't install the desktop app: the web app is the way in.
    var open = document.createElement('a');
    open.className = 'button primary';
    open.href = '/web/';
    open.textContent = 'Open Infimeety in your browser';
    var buttons = document.getElementById('buttons');
    buttons.insertBefore(open, buttons.firstChild);
    document.getElementById('mac-help').style.display = 'none';
  }
  if (mac) document.getElementById('mac-help').setAttribute('open', '');

  fetch('https://api.github.com/repos/teamcreatovert/infimeety/releases/latest')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (release) {
      if (!release) return;
      var names = (release.assets || []).map(function (a) { return a.name; });
      var version = String(release.tag_name || '').replace(/^v/, '');
      if (names.indexOf('Infimeety.dmg') < 0) {
        var m = document.getElementById('mac');
        m.setAttribute('aria-disabled', 'true');
        m.removeAttribute('href');
        m.querySelector('span').innerHTML = 'Mac <small>coming with the next update</small>';
      }
      if (version) document.getElementById('meta').textContent = 'Version ' + version + ' · Windows 10 or 11 · macOS 11 or later, Apple Silicon and Intel';
    })
    .catch(function () {});
})();
