// infimeety.pages.dev: once someone uses Infimeety in this browser, the home page takes them
// straight into it next time. Add ?home to the address to see this page anyway.
(function () {
  try {
    var params = new URLSearchParams(location.search);
    if (!params.has('home') && (localStorage.getItem('infimeety.web') || localStorage.getItem('infimeety.session'))) {
      location.replace('/web/' + location.search + location.hash);
      return;
    }
  } catch (e) {}

  // Choosing the browser version remembers it.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-web]');
    if (!link) return;
    try {
      localStorage.setItem('infimeety.web', '1');
    } catch (err) {}
  });

  // "Join a meeting": accept a pasted link or a code.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches || !form.matches('[data-meet]')) return;
    e.preventDefault();
    var raw = String(new FormData(form).get('meet') || '').trim();
    var code = (raw.match(/[a-z0-9]{4}-?[a-z0-9]{4}-?[a-z0-9]{3}/i) || [''])[0].toLowerCase().replace(/-/g, '');
    var input = form.querySelector('input');
    if (code.length !== 11) {
      input.setCustomValidity('That doesn’t look like a meeting code, like gyus-768g-hsf.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    try {
      localStorage.setItem('infimeety.web', '1');
    } catch (err) {}
    location.href = '/web/?meet=' + code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8);
  });
  document.addEventListener('input', function (e) {
    if (e.target.setCustomValidity) e.target.setCustomValidity('');
  });
})();
