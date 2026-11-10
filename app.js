/* Metro Times — standalone static app (GitHub Pages).
   Live data: WMATA StationPrediction API, called directly from the browser
   (api.wmata.com sends Access-Control-Allow-Origin: *). The WMATA key is
   NEVER in this code — the user enters it once and it is stored only in
   their own browser's localStorage. */
'use strict';

var LS_KEY = 'metro-wmata-key';
var LS_FAV = 'metro-favorites';
var LS_SEL = 'metro-selected';
var LS_ANCHOR = 'metro-anchor';
var SEED_FAVORITES = ['N12', 'C04', 'C03']; // Ashburn, Foggy Bottom-GWU, Farragut West
var SEED_SELECTED = 'C04'; // Foggy Bottom-GWU
var GEO_BUDGET_MS = 25000; // ONE total geolocation budget
var REFRESH_MS = 30000;

var LINES = {
  RD: { name: 'Red', color: '#BF0D3E' },
  OR: { name: 'Orange', color: '#ED8B00' },
  SV: { name: 'Silver', color: '#A2AAAD' },
  BL: { name: 'Blue', color: '#009CDE' },
  YL: { name: 'Yellow', color: '#FFD100' },
  GR: { name: 'Green', color: '#00B140' }
};
// Light line colors need dark text on the pill for contrast.
function pillTextColor(hex) { return (hex === '#FFD100' || hex === '#A2AAAD') ? '#1c2b26' : '#fff'; }

var stations = [];
var byCode = {};
var apiKey = null;
var favorites = [];
var selectedCode = null;
var anchorCode = null;
var userLoc = null; // {lat, lon, source: 'gps'|'anchor'}
var locating = false;
var locateCancelled = false;
var locateTimer = null;
var refreshTimer = null;
var lineFilter = 'ALL';
var searchText = '';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function loadPrefs() {
  var f = lsGet(LS_FAV);
  favorites = f ? JSON.parse(f) : SEED_FAVORITES.slice();
  selectedCode = lsGet(LS_SEL) || SEED_SELECTED;
  anchorCode = lsGet(LS_ANCHOR) || null;
}
function saveFavorites() { lsSet(LS_FAV, JSON.stringify(favorites)); }
function saveSelected() { lsSet(LS_SEL, selectedCode); }
function saveAnchor() { if (anchorCode) lsSet(LS_ANCHOR, anchorCode); else lsDel(LS_ANCHOR); }

function stationByCode(code) { return byCode[code] || null; }
function primaryStation(code) {
  // a favorite/selected code may be any of a station's codes; resolve to the station
  for (var i = 0; i < stations.length; i++) {
    if (stations[i].codes.indexOf(code) !== -1) return stations[i];
  }
  return null;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  var R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}
function lineDots(codes) {
  return codes.map(function (c) {
    var L = LINES[c] || { color: '#888' };
    return '<span class="dot" title="' + esc(L.name) + '" style="background:' + L.color + '"></span>';
  }).join('');
}
function linePills(codes) {
  return codes.map(function (c) {
    var L = LINES[c] || { name: c, color: '#888' };
    return '<span class="pill" title="' + esc(L.name) + ' line" style="background:' + L.color + ';color:' + pillTextColor(L.color) + '">' + esc(c) + '</span>';
  }).join('');
}

/* ---------- key entry ---------- */
function showKeyScreen(msg) {
  $('keyScreen').hidden = false;
  $('mainApp').hidden = true;
  if (msg) { $('keyError').textContent = msg; $('keyError').hidden = false; }
  else { $('keyError').hidden = true; }
}
function showMain() {
  $('keyScreen').hidden = true;
  $('mainApp').hidden = false;
}
function saveKey() {
  var v = $('keyInput').value.trim();
  if (!v) { $('keyError').textContent = 'Paste your key first.'; $('keyError').hidden = false; return; }
  apiKey = v;
  lsSet(LS_KEY, v);
  $('keyInput').value = '';
  showMain();
  renderAll();
  fetchPredictions();
}

/* ---------- location ---------- */
function geoErrorMessage(err) {
  if (!err) return 'Could not get your location.';
  switch (err.code) {
    case 1: return 'Location access was denied — enable location permission in your browser settings and try again.';
    case 2: return 'Could not get your location — make sure location services (GPS) are on and try again.';
    case 3: return 'Location request timed out (25 seconds) — try again where the signal is better.';
    default: return 'Unknown error while getting your location.';
  }
}
function setLocating(on) {
  locating = on;
  $('locateBtn').disabled = on;
  $('cancelLocateBtn').hidden = !on;
}
function stopLocating() {
  if (locateTimer) { clearTimeout(locateTimer); locateTimer = null; }
  setLocating(false);
}
function onLocateCancel() {
  locateCancelled = true;
  stopLocating();
  $('nearestStation').textContent = '';
  $('locStatus').textContent = 'Location search stopped.';
}
function useLocation(lat, lon, source) {
  userLoc = { lat: lat, lon: lon, source: source };
  var nearest = nearestStation();
  if (nearest) {
    $('nearestStation').textContent = nearest.name + ' — ' + nearest.dist.toFixed(1) + ' km';
    $('locStatus').textContent = source === 'gps' ? 'Your current location' : 'Your saved location';
    // The board follows the nearest station: select it, persist the
    // selection exactly like a manual station pick, and load its live
    // predictions. This covers both GPS success and the saved-anchor
    // fallback (both call useLocation).
    selectedCode = nearest.code;
    saveSelected();
  }
  renderStations();
  if (nearest) fetchPredictions();
}
function nearestStation() {
  if (!userLoc) return null;
  var best = null;
  stations.forEach(function (s) {
    var d = haversineKm(userLoc.lat, userLoc.lon, s.lat, s.lon);
    if (!best || d < best.dist) best = { station: s, dist: d };
  });
  return best ? { name: best.station.name, code: best.station.code, dist: best.dist } : null;
}
function fallbackToAnchor(reason) {
  if (anchorCode) {
    var a = primaryStation(anchorCode);
    if (a) {
      $('locStatus').textContent = reason + ' — using your saved location (' + a.name + ').';
      useLocation(a.lat, a.lon, 'anchor');
      return true;
    }
  }
  return false;
}
function onLocate() {
  if (!navigator.geolocation) {
    $('locStatus').textContent = 'This browser does not support location.';
    if (!fallbackToAnchor('This browser does not support location')) $('nearestStation').textContent = '';
    return;
  }
  locateCancelled = false;
  setLocating(true);
  $('nearestStation').textContent = '';
  $('locStatus').textContent = 'Locating you… (up to 25 seconds)';
  var done = false;
  function finish() { if (!done) { done = true; stopLocating(); } }
  locateTimer = setTimeout(function () {
    if (done) return;
    finish();
    $('locStatus').textContent = 'Location request timed out (25 seconds).';
    if (!fallbackToAnchor('Location request timed out')) $('nearestStation').textContent = '';
  }, GEO_BUDGET_MS);
  try {
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (done || locateCancelled) return;
      finish();
      useLocation(pos.coords.latitude, pos.coords.longitude, 'gps');
    }, function (err) {
      if (done || locateCancelled) return;
      finish();
      var msg = geoErrorMessage(err);
      $('locStatus').textContent = msg;
      if (!fallbackToAnchor(msg)) $('nearestStation').textContent = '';
    }, { enableHighAccuracy: true, timeout: GEO_BUDGET_MS, maximumAge: 0 });
  } catch (e) {
    finish();
    $('locStatus').textContent = 'Could not get your location.';
    if (!fallbackToAnchor('Could not get your location')) $('nearestStation').textContent = '';
  }
}

/* ---------- predictions ---------- */
function minSortValue(min) {
  if (min === 'ARR' || min === 'BRD') return 0;
  var n = parseInt(min, 10);
  return isNaN(n) ? 999 : n;
}
function minLabel(min) {
  if (min === 'ARR') return 'ARR';
  if (min === 'BRD') return 'BRD';
  if (min === '—' || min === '' || min == null) return '—';
  return min + ' min';
}
function fetchPredictions() {
  var st = primaryStation(selectedCode);
  if (!st || !apiKey) return;
  $('boardStation').textContent = st.name;
  $('boardLines').innerHTML = linePills(st.lines);
  $('boardMsg').textContent = 'Loading times…';
  $('trainList').innerHTML = '';
  var urls = st.codes.map(function (c) {
    return fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + c, {
      headers: { 'api_key': apiKey }
    }).then(function (r) {
      if (r.status === 401) { var e = new Error('bad-key'); e.status = 401; throw e; }
      if (!r.ok) { var e2 = new Error('http-' + r.status); e2.status = r.status; throw e2; }
      return r.json();
    });
  });
  Promise.all(urls.map(function (p) { return p.catch(function (e) { return { __error: e }; }); }))
    .then(function (results) {
      var badKey = results.some(function (r) { return r && r.__error && r.__error.status === 401; });
      if (badKey) {
        $('boardMsg').textContent = 'The key is invalid or expired — check your WMATA key and enter it again.';
        return;
      }
      var trains = [];
      var seen = {};
      results.forEach(function (r) {
        if (!r || r.__error || !Array.isArray(r.Trains)) return;
        r.Trains.forEach(function (t) {
          var k = (t.Line || '') + '|' + (t.DestinationName || '') + '|' + (t.Min || '');
          if (seen[k]) return;
          seen[k] = true;
          trains.push(t);
        });
      });
      trains.sort(function (a, b) { return minSortValue(a.Min) - minSortValue(b.Min); });
      var html = trains.map(function (t) {
        var L = LINES[t.Line] || { name: t.Line, color: '#888' };
        return '<li><span class="pill" title="' + esc(L.name) + ' line" style="background:' + L.color + ';color:' + pillTextColor(L.color) + '">' + esc(t.Line || '') + '</span>' +
          '<span class="tr-dest">' + esc(t.DestinationName || t.Destination || '') + '</span>' +
          '<span class="tr-min">' + esc(minLabel(t.Min)) + '</span></li>';
      }).join('');
      $('trainList').innerHTML = html;
      $('boardMsg').textContent = trains.length ? '' : 'No trains arriving at this station right now.';
      $('boardUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' — refreshes automatically every 30 seconds.';
    })
    .catch(function () {
      $('boardMsg').textContent = 'Could not reach WMATA — check your connection and try again.';
    });
}
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function () { if (apiKey && !document.hidden) fetchPredictions(); }, REFRESH_MS);
}

/* ---------- station list ---------- */
function stationMatches(st) {
  if (lineFilter !== 'ALL' && st.lines.indexOf(lineFilter) === -1) return false;
  if (searchText) {
    var q = searchText.toLowerCase();
    var hay = (st.name + ' ' + st.code + ' ' + st.codes.join(' ')).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}
function stationRow(st) {
  var isFav = favorites.indexOf(st.code) !== -1;
  var isSel = selectedCode && st.codes.indexOf(selectedCode) !== -1;
  var dist = '';
  if (userLoc) {
    dist = '<span class="st-dist">' + haversineKm(userLoc.lat, userLoc.lon, st.lat, st.lon).toFixed(1) + ' km</span>';
  }
  var isAnchor = anchorCode && st.codes.indexOf(anchorCode) !== -1;
  return '<li data-code="' + esc(st.code) + '" class="' + (isSel ? 'selected' : '') + '">' +
    '<span class="st-name">' + esc(st.name) + '</span>' +
    '<span class="linedots">' + lineDots(st.lines) + '</span>' +
    '<span class="st-code">' + esc(st.code) + '</span>' + dist +
    '<button class="star ' + (isFav ? '' : 'off') + '" data-fav="' + esc(st.code) + '" title="Favorite">' + (isFav ? '★' : '☆') + '</button>' +
    '<button class="anchor-btn ' + (isAnchor ? 'set' : '') + '" data-anchor="' + esc(st.code) + '" title="Save as my saved location">' + (isAnchor ? 'Saved ✓' : 'Save location') + '</button>' +
    '</li>';
}
function renderStations() {
  var favStations = favorites.map(primaryStation).filter(Boolean);
  $('favList').innerHTML = favStations.length
    ? favStations.map(function (st) {
        return '<button class="chip fav-chip" data-code="' + esc(st.code) + '"><span class="star-glyph">★</span> ' + esc(st.name) + '</button>';
      }).join('')
    : '<p class="muted">No favorite stations yet — tap ★ next to any station.</p>';
  var list = stations.filter(stationMatches);
  if (userLoc) {
    list = list.slice().sort(function (a, b) {
      return haversineKm(userLoc.lat, userLoc.lon, a.lat, a.lon) - haversineKm(userLoc.lat, userLoc.lon, b.lat, b.lon);
    });
  }
  $('stationList').innerHTML = list.length ? list.map(stationRow).join('') : '<li class="muted">No matching stations.</li>';
  $('stationCount').textContent = '(' + list.length + ' of ' + stations.length + ')';
}
function renderLineFilter() {
  var chips = [{ code: 'ALL', name: 'All' }].concat(Object.keys(LINES).map(function (c) {
    return { code: c, name: LINES[c].name, color: LINES[c].color };
  }));
  $('lineFilter').innerHTML = chips.map(function (ch) {
    var dot = ch.color ? '<span class="dot" style="background:' + ch.color + '"></span> ' : '';
    return '<button class="chip' + (lineFilter === ch.code ? ' active' : '') + '" data-line="' + ch.code + '">' + dot + esc(ch.name) + '</button>';
  }).join('');
}
function renderAnchorLine() {
  if (anchorCode) {
    var a = primaryStation(anchorCode);
    $('anchorLine').hidden = false;
    $('anchorLine').textContent = 'Saved location: ' + (a ? a.name : anchorCode) + ' — used automatically if location detection fails.';
    $('clearAnchorBtn').hidden = false;
  } else {
    $('anchorLine').hidden = true;
    $('clearAnchorBtn').hidden = true;
  }
}
function renderAll() {
  renderLineFilter();
  renderStations();
  renderAnchorLine();
  var st = primaryStation(selectedCode);
  if (st) { $('boardStation').textContent = st.name; $('boardLines').innerHTML = linePills(st.lines); }
}

/* ---------- events ---------- */
function bindEvents() {
  $('saveKeyBtn').addEventListener('click', saveKey);
  $('keyInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveKey(); });
  $('changeKeyBtn').addEventListener('click', function () {
    lsDel(LS_KEY); apiKey = null;
    if (refreshTimer) clearInterval(refreshTimer);
    showKeyScreen();
    $('keyInput').focus();
  });
  $('locateBtn').addEventListener('click', onLocate);
  $('cancelLocateBtn').addEventListener('click', onLocateCancel);
  $('refreshBtn').addEventListener('click', fetchPredictions);
  $('clearAnchorBtn').addEventListener('click', function () {
    anchorCode = null; saveAnchor(); renderAnchorLine(); renderStations();
  });
  $('searchInput').addEventListener('input', function () { searchText = this.value.trim(); renderStations(); });
  $('lineFilter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-line]');
    if (!b) return;
    lineFilter = b.dataset.line;
    renderLineFilter(); renderStations();
  });
  function listClick(e) {
    var favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.stopPropagation();
      var code = favBtn.dataset.fav;
      var i = favorites.indexOf(code);
      if (i === -1) favorites.push(code); else favorites.splice(i, 1);
      saveFavorites(); renderStations();
      return;
    }
    var ancBtn = e.target.closest('[data-anchor]');
    if (ancBtn) {
      e.stopPropagation();
      anchorCode = ancBtn.dataset.anchor;
      saveAnchor(); renderAnchorLine(); renderStations();
      return;
    }
    var pick = e.target.closest('[data-code]');
    if (pick) {
      selectedCode = pick.dataset.code;
      saveSelected();
      renderStations();
      fetchPredictions();
    }
  }
  $('favList').addEventListener('click', listClick);
  $('stationList').addEventListener('click', listClick);
}

/* ---------- service worker (PWA install; silent if unavailable) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline install unavailable; app still works */ });
  });
}

/* ---------- boot ---------- */
fetch('stations.json').then(function (r) { return r.json(); }).then(function (data) {
  stations = data;
  stations.forEach(function (s) { s.codes.forEach(function (c) { byCode[c] = s; }); });
  loadPrefs();
  bindEvents();
  apiKey = lsGet(LS_KEY);
  if (!apiKey) { showKeyScreen(); return; }
  showMain();
  renderAll();
  fetchPredictions();
  startAutoRefresh();
}).catch(function () {
  document.body.innerHTML = '<p style="padding:20px">Could not load the station list — check your connection and reopen the page.</p>';
});
