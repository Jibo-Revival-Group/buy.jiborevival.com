(function () {
  'use strict';
  var NAMES = { ebay: 'eBay', mercari: 'Mercari', facebook: 'Facebook Marketplace', craigslist: 'Craigslist' };
  var DAY = 864e5, data = { listings: [], sources: {} }, off = {};
  var $ = function (id) { return document.getElementById(id); };

  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
    if (m < 60) return m <= 1 ? 'just now' : m + ' minutes ago';
    var h = Math.round(m / 60); if (h < 24) return h === 1 ? '1 hour ago' : h + ' hours ago';
    var d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function card(l) {
    var li = el('li', 'card'), a = el('a', 'card-link');
    a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
    var pic = el('div', 'pic');
    if (l.image) { var img = el('img'); img.src = l.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.onerror = function () { img.remove(); }; pic.appendChild(img); }
    if (Date.now() - Date.parse(l.firstSeen) < 2 * DAY) pic.appendChild(el('span', 'new', 'New'));
    a.appendChild(pic);
    var body = el('div', 'card-body');
    body.appendChild(el('span', 'source ' + l.source, NAMES[l.source] || l.source));
    body.appendChild(el('h3', null, l.title));
    var meta = el('p', 'meta');
    meta.appendChild(el('strong', 'price', l.priceText || 'See listing'));
    if (l.location) meta.appendChild(el('span', null, l.location));
    body.appendChild(meta);
    body.appendChild(el('p', 'seen', 'Found ' + ago(l.firstSeen)));
    a.appendChild(body); a.setAttribute('aria-label', l.title + ', ' + (l.priceText || 'price on listing') + ', on ' + (NAMES[l.source] || l.source));
    li.appendChild(a); return li;
  }

  function render() {
    var q = $('q').value.trim().toLowerCase(), sort = $('sort').value;
    var list = data.listings.filter(function (l) { return !off[l.source] && (!q || (l.title + ' ' + (l.location || '')).toLowerCase().indexOf(q) !== -1); });
    if (sort !== 'new') list = list.slice().sort(function (a, b) {
      if (a.price == null) return 1; if (b.price == null) return -1; return sort === 'low' ? a.price - b.price : b.price - a.price;
    });
    var grid = $('grid'); grid.textContent = '';
    list.forEach(function (l) { grid.appendChild(card(l)); });
    $('count').textContent = '(' + list.length + ')';
    $('empty').hidden = list.length > 0;
  }

  function chips() {
    var box = $('sources');
    Object.keys(NAMES).forEach(function (s) {
      var n = data.listings.filter(function (l) { return l.source === s; }).length, b = el('button', 'chip ' + s);
      b.type = 'button'; b.setAttribute('aria-pressed', 'true');
      b.textContent = NAMES[s] + ' · ' + n;
      if ((data.sources[s] || {}).error) b.title = 'Couldn’t check ' + NAMES[s] + ' last time; showing its previous listings.';
      b.onclick = function () { off[s] = !off[s]; b.setAttribute('aria-pressed', String(!off[s])); render(); };
      box.appendChild(b);
    });
  }

  $('q').addEventListener('input', render); $('sort').addEventListener('change', render);
  fetch('./listings.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    data = d; $('updated').textContent = 'Updated ' + ago(d.updated); chips(); render();
  }).catch(function () { $('updated').textContent = 'Couldn’t load listings'; $('empty').hidden = false; });
})();
