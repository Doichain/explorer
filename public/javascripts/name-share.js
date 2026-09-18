// The share button next to a name, on the transaction page and the name page.
//
// Two ways out, in this order: the browser's own share sheet where there is one
// -- that is what actually reaches the messaging and social apps -- and the
// clipboard otherwise. Closing the sheet is a deliberate act, not a failure, so
// it must not silently turn into a copy; any other error does fall through.
//
// Only `url` is handed to the share sheet. Passing `text` as well made
// receiving apps paste the name AND the link, one under the other, which read
// as the name twice.
(function () {
  var LABEL = 'Share link to this name';

  function shareUrl(name) {
    // Slashes stay slashes: they are path separators in /name/<name> and the
    // route puts the name back together. Everything else is encoded, so a name
    // holding ? or # cannot cut the link short.
    var path = name.split('/').map(encodeURIComponent).join('/');
    return location.origin + '/name/' + path;
  }

  function flash(btn, text) {
    var icon = btn.querySelector('.fa');
    var previous = icon ? icon.className : null;
    if (icon) icon.className = 'fa fa-check';
    btn.setAttribute('title', text);
    setTimeout(function () {
      if (icon && previous) icon.className = previous;
      btn.setAttribute('title', LABEL);
    }, 1800);
  }

  function copy(url, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        flash(btn, 'Link copied');
      }, function () {
        window.prompt('Copy this link:', url);
      });
      return;
    }
    // No clipboard API: an older browser, or a page not served over https.
    var ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
    document.body.removeChild(ta);
    if (copied) flash(btn, 'Link copied');
    else window.prompt('Copy this link:', url);
  }

  document.addEventListener('click', function (e) {
    // The click usually lands on the icon inside the button, so walk up.
    var el = e.target;
    while (el && el !== document && !(el.classList && el.classList.contains('name-share'))) {
      el = el.parentNode;
    }
    if (!el || el === document) return;
    e.preventDefault();

    var name = el.getAttribute('data-name');
    if (!name) return;
    var url = shareUrl(name);

    if (navigator.share) {
      navigator.share({ title: name, url: url }).catch(function (err) {
        if (err && err.name === 'AbortError') return;   // sheet closed on purpose
        copy(url, el);
      });
      return;
    }
    copy(url, el);
  });
})();
