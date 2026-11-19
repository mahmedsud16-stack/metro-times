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
// Route order per line, terminus to terminus, by station primary code.
// Verified against line geography: Red Shady Grove <-> Glenmont, Orange
// Vienna <-> New Carrollton, Silver Ashburn <-> Downtown Largo, Blue
// Franconia-Springfield <-> Downtown Largo, Yellow Huntington <-> Greenbelt,
// Green Branch Ave <-> Greenbelt. (B35 NoMa sits between Union Station and
// Rhode Island Ave; N05 does not exist on Silver.)
var LINE_ORDER = {
  RD: ['A15','A14','A13','A12','A11','A10','A09','A08','A07','A06','A05','A04','A03','A02','A01','B01','B02','B03','B35','B04','B05','B06','B07','B08','B09','B10','B11'],
  OR: ['K08','K07','K06','K05','K04','K03','K02','K01','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12','D13'],
  SV: ['N12','N11','N10','N09','N08','N07','N06','N04','N03','N02','N01','K05','K04','K03','K02','K01','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','G01','G02','G03','G04','G05'],
  BL: ['J03','J02','C13','C12','C11','C10','C09','C08','C07','C06','C05','C04','C03','C02','A01','D01','D02','D03','D04','D05','D06','D07','D08','G01','G02','G03','G04','G05'],
  YL: ['C15','C14','C13','C12','C11','C10','C09','C08','C07','D03','F02','B01','E01','E02','E03','E04','E05','B06','E07','E08','E09','E10'],
  GR: ['F11','F10','F09','F08','F07','F06','F05','F04','D03','F02','B01','E01','E02','E03','E04','E05','B06','E07','E08','E09','E10']
};
var LINE_SECTION_ORDER = ['RD', 'OR', 'SV', 'BL', 'YL', 'GR'];
// Light line colors need dark text on the pill for contrast.
function pillTextColor(hex) { return (hex === '#FFD100' || hex === '#A2AAAD') ? '#16233f' : '#fff'; }

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
function trainRowHTML(t) {
  var L = LINES[t.Line] || { name: t.Line, color: '#888' };
  var cars = carLabel(t.Car);
  return '<li><span class="tr-cars"' + (cars ? ' title="' + esc(cars + ' cars') + '"' : '') + '>' + (cars ? TRAIN_ICON + '<b>' + esc(cars) + '</b>' : '') + '</span>' +
    '<span class="pill" title="' + esc(L.name) + ' line" style="background:' + L.color + ';color:' + pillTextColor(L.color) + '">' + esc(t.Line || '') + '</span>' +
    '<span class="tr-dest">' + esc(t.DestinationName || t.Destination || '') + '</span>' +
    '<span class="tr-min">' + esc(minLabel(t.Min)) + '</span></li>';
}
// Group trains by WMATA direction (the prediction's Group field: "1"/"2"),
// like wmata.com: each direction gets its own section, headed by the
// destinations in that direction. Trains without a Group fall back to
// grouping by destination, so they never vanish. Direction groups come
// first, in WMATA order (1 then 2); trains inside a group stay sorted
// by minutes (the caller sorts first).
// Direction of a train relative to the selected station, from line
// geography (LINE_ORDER): -1 = toward the line's first terminus,
// +1 = toward the last terminus, 0 = terminating at this station.
// This reproduces wmata.com's direction grouping at every station —
// including termini like Ashburn, where the API's Group field does not
// reliably split arrivals from departures. Returns null when the
// direction cannot be worked out (caller falls back to Group, then
// to grouping by destination). One exception: a destination that is not
// on this line at all (WMATA signs some departures with another line's
// terminus — Silver trains from Ashburn for New Carrollton, D13) is
// still a departure when the station is a terminus of the train's line,
// because there is only one way out.
function trainDirection(t, station) {
  var order = LINES[t.Line] ? LINE_ORDER[t.Line] : null;
  var destCode = t.DestinationCode;
  if (!order || !destCode || !station) return null;
  var stationCode = null;
  for (var i = 0; i < station.codes.length; i++) {
    if (order.indexOf(station.codes[i]) !== -1) { stationCode = station.codes[i]; break; }
  }
  if (!stationCode) return null;
  var si = order.indexOf(stationCode), di = order.indexOf(destCode);
  if (di === -1) {
    // Destination is not on this line. At a terminus a non-terminating
    // train must be leaving: first station in the order -> +1 (toward
    // the last terminus), last station -> -1. Anywhere else, unknown.
    if (si === 0) return 1;
    if (si === order.length - 1) return -1;
    return null;
  }
  if (di === si) return 0;
  return di < si ? -1 : 1;
}
function groupTrainsHTML(trains, station) {
  var groups = [];
  var byKey = {};
  trains.forEach(function (t) {
    var dir = trainDirection(t, station);
    var key, sort;
    if (dir !== null) { key = 'd' + dir; sort = dir === -1 ? 0 : (dir === 1 ? 1 : 2); }
    else if (t.Group) { key = 'g' + t.Group; sort = 3 + parseInt(t.Group, 10); }
    else { key = 'x' + (t.DestinationName || t.Destination || ''); sort = 10; }
    var g = byKey[key];
    if (!g) { g = { key: key, sort: sort, order: groups.length, trains: [], dests: [], terminating: dir === 0, estimated: true }; byKey[key] = g; groups.push(g); }
    g.trains.push(t);
    if (!t.__estimated) g.estimated = false;
    var d = t.DestinationName || t.Destination || '';
    if (d && g.dests.indexOf(d) === -1) g.dests.push(d);
  });
  // Leaving groups first (one direction, then the other), terminating
  // trains last — the order wmata.com shows at a terminus.
  groups.sort(function (a, b) { return (a.sort - b.sort) || (a.order - b.order); });
  return groups.map(function (g) {
    var head = (g.terminating && station) ? 'Arriving at ' + station.name + (g.estimated ? ' (estimated)' : '') : (g.dests.join(', ') || 'Trains');
    return '<div class="dir-group"><h3 class="dir-head">' + esc(head) + '</h3><ul class="trains">' +
      g.trains.map(trainRowHTML).join('') + '</ul></div>';
  }).join('');
}
function minLabel(min) {
  if (min === 'ARR') return 'ARR';
  if (min === 'BRD') return 'BRD';
  if (min === '—' || min === '' || min == null) return '—';
  return min + ' min';
}
// WMATA reports the train length in the prediction's Car field — usually
// "6" or "8"; "--" (or missing) means WMATA has no car count for that
// train, so show nothing rather than a wrong number. Display matches
// wmata.com: a small train icon + the number, at the left of the row.
var TRAIN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="3" width="16" height="14" rx="3"/><line x1="4" y1="10" x2="20" y2="10"/><circle cx="8" cy="20" r="1.6" fill="currentColor" stroke="none"/><circle cx="16" cy="20" r="1.6" fill="currentColor" stroke="none"/></svg>';
function carLabel(car) {
  var n = parseInt(car, 10);
  if (isNaN(n) || n <= 0) return '';
  return String(n);
}
// WMATA sometimes lists non-passenger moves (Line "No", Min "---") —
// they carry no riders, so they never reach the board.
function isUsableTrain(t) {
  return !!t && t.Min !== '---' && t.Line !== 'No';
}
// Terminus arrivals (v18): WMATA's public API never returns trains that
// terminate at the queried station — at every terminus (verified Ashburn,
// Glenmont, Vienna, 2026-11-18) it returns departures only, while
// wmata.com shows the arrivals from its internal data. So for a terminus
// we also read the previous station's board and derive the arrivals: a
// train there whose destination is this terminus reaches it ~offsetMin
// minutes after its time at the previous station (verified live
// 2026-11-18: N11 BRD/12/22 -> Ashburn 3/16/26 on wmata.com, i.e.
// +3-4 min; offset errs early, the safe side for catching a train).
// Derived times are estimates, so the group header says so. Only termini
// with a verified offset belong here — do not guess one.
var TERMINUS_ARRIVALS = {
  N12: { prev: 'N11', offsetMin: 3 } // Ashburn <- Loudoun Gateway (Silver)
};
function terminusArrivalConfig(st) {
  if (!st) return null;
  for (var i = 0; i < st.codes.length; i++) {
    if (TERMINUS_ARRIVALS[st.codes[i]]) return TERMINUS_ARRIVALS[st.codes[i]];
  }
  return null;
}
function derivedArrivalTrains(prevTrains, st, cfg) {
  var out = [];
  prevTrains.forEach(function (t) {
    if (!t || t.DestinationCode !== st.code) return;
    if (!isUsableTrain(t)) return;
    var derived;
    if (t.Min === 'BRD' || t.Min === 'ARR') derived = String(cfg.offsetMin);
    else {
      var n = parseInt(t.Min, 10);
      if (isNaN(n)) return;
      derived = String(n + cfg.offsetMin);
    }
    out.push({ Line: t.Line, DestinationCode: st.code, DestinationName: st.name, Destination: st.name, Min: derived, Car: t.Car, Group: '', __estimated: true });
  });
  return out;
}
function fetchPredictions() {
  var st = primaryStation(selectedCode);
  if (!st || !apiKey) return;
  $('boardStation').textContent = st.name;
  $('boardLines').innerHTML = linePills(st.lines);
  $('boardMsg').textContent = 'Loading times…';
  $('trainList').innerHTML = '';
  function fetchStation(code) {
    return fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + code, {
      headers: { 'api_key': apiKey }
    }).then(function (r) {
      if (r.status === 401) { var e = new Error('bad-key'); e.status = 401; throw e; }
      if (!r.ok) { var e2 = new Error('http-' + r.status); e2.status = r.status; throw e2; }
      return r.json();
    });
  }
  function caught(p) { return p.catch(function (e) { return { __error: e }; }); }
  var termCfg = terminusArrivalConfig(st);
  var mainP = Promise.all(st.codes.map(function (c) { return caught(fetchStation(c)); }));
  var arrP = termCfg ? caught(fetchStation(termCfg.prev)) : Promise.resolve(null);
  Promise.all([mainP, arrP]).then(function (pair) {
    var results = pair[0], arrRes = pair[1];
    var badKey = results.some(function (r) { return r && r.__error && r.__error.status === 401; }) ||
      (arrRes && arrRes.__error && arrRes.__error.status === 401);
    if (badKey) {
      $('boardMsg').textContent = 'The key is invalid or expired — check your WMATA key and enter it again.';
      return;
    }
    var trains = [];
    var seen = {};
    results.forEach(function (r) {
      if (!r || r.__error || !Array.isArray(r.Trains)) return;
      r.Trains.forEach(function (t) {
        if (!isUsableTrain(t)) return;
        var k = (t.Line || '') + '|' + (t.DestinationName || '') + '|' + (t.Min || '') + '|' + (t.Car || '');
        if (seen[k]) return;
        seen[k] = true;
        trains.push(t);
      });
    });
    // Terminus arrivals, derived from the previous station (see above).
    // If the API ever starts returning real terminating trains, those win
    // and the derived ones are skipped entirely.
    if (termCfg && arrRes && !arrRes.__error && Array.isArray(arrRes.Trains)) {
      var hasRealArrivals = trains.some(function (t) { return t.DestinationCode === st.code; });
      if (!hasRealArrivals) {
        derivedArrivalTrains(arrRes.Trains, st, termCfg).forEach(function (t) {
          var k = (t.Line || '') + '|' + (t.DestinationName || '') + '|' + (t.Min || '') + '|' + (t.Car || '');
          if (seen[k]) return;
          seen[k] = true;
          trains.push(t);
        });
      }
    }
    trains.sort(function (a, b) { return minSortValue(a.Min) - minSortValue(b.Min); });
    $('trainList').innerHTML = groupTrainsHTML(trains, st);
    $('boardMsg').textContent = trains.length ? '' : 'No trains arriving at this station right now.';
    $('boardUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' — refreshes automatically every 30 seconds.';
  }).catch(function () {
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
  var dist = '<span class="st-dist">' + (userLoc ? haversineKm(userLoc.lat, userLoc.lon, st.lat, st.lon).toFixed(1) + ' km' : '') + '</span>';
  var isAnchor = anchorCode && st.codes.indexOf(anchorCode) !== -1;
  return '<li data-code="' + esc(st.code) + '" class="' + (isSel ? 'selected' : '') + '">' +
    '<span class="st-name">' + esc(st.name) + '</span>' +
    '<span class="linedots">' + lineDots(st.lines) + '</span>' +
    '<span class="st-code">' + esc(st.code) + '</span>' + dist +
    '<button class="star ' + (isFav ? '' : 'off') + '" data-fav="' + esc(st.code) + '" title="Favorite">' + (isFav ? '★' : '☆') + '</button>' +
    '<button class="anchor-btn ' + (isAnchor ? 'set' : '') + '" data-anchor="' + esc(st.code) + '" title="Save as my saved location">' + (isAnchor ? 'Saved ✓' : 'Save location') + '</button>' +
    '</li>';
}
function lineStationsInOrder(line) {
  // That line's stations in route order (LINE_ORDER), looked up by primary
  // code. A transfer station appears in every line it serves.
  var byPrimary = {};
  stations.forEach(function (s) { byPrimary[s.code] = s; });
  return LINE_ORDER[line].map(function (code) { return byPrimary[code]; })
    .filter(function (s) { return s && s.lines.indexOf(line) !== -1; });
}
function renderStations() {
  var favStations = favorites.map(primaryStation).filter(Boolean);
  $('favList').innerHTML = favStations.length
    ? favStations.map(function (st) {
        return '<button class="chip fav-chip" data-code="' + esc(st.code) + '"><span class="star-glyph">★</span> ' + esc(st.name) + '</button>';
      }).join('')
    : '<p class="muted">No favorite stations yet — tap ★ next to any station.</p>';
  var container = $('stationList');
  if (searchText) {
    // Search results stay a flat list (grouping does not apply to search).
    var list = stations.filter(stationMatches);
    if (userLoc) {
      list = list.slice().sort(function (a, b) {
        return haversineKm(userLoc.lat, userLoc.lon, a.lat, a.lon) - haversineKm(userLoc.lat, userLoc.lon, b.lat, b.lon);
      });
    }
    container.innerHTML = list.length ? '<ul class="stations">' + list.map(stationRow).join('') + '</ul>' : '<p class="muted">No matching stations.</p>';
    $('stationCount').textContent = '(' + list.length + ' of ' + stations.length + ')';
    return;
  }
  // Grouped by line, one section per line in route order. The line filter
  // shows only that line's section; "All" shows all six. Route order wins
  // over distance sorting here — distances are still shown on each row.
  var lines = lineFilter === 'ALL' ? LINE_SECTION_ORDER : [lineFilter];
  container.innerHTML = lines.map(function (line) {
    var L = LINES[line];
    var rows = lineStationsInOrder(line);
    return '<div class="line-section">' +
      '<h4 class="line-head" style="background:' + L.color + ';color:' + pillTextColor(L.color) + '">' +
      '<span>' + esc(L.name) + ' Line</span><span class="line-head-count">' + rows.length + ' stations</span></h4>' +
      '<ul class="stations">' + rows.map(stationRow).join('') + '</ul></div>';
  }).join('');
  var shown = lineFilter === 'ALL' ? stations.length : lineStationsInOrder(lineFilter).length;
  $('stationCount').textContent = '(' + shown + ' stations)';
}
function renderLineFilter() {
  var chips = [{ code: 'ALL', name: 'All' }].concat(Object.keys(LINES).map(function (c) {
    return { code: c, name: LINES[c].name, color: LINES[c].color };
  }));
  $('lineFilter').innerHTML = chips.map(function (ch) {
    var active = lineFilter === ch.code;
    // The active chip wears its line color (the chip itself is the color,
    // so no separate dot); "All" stays dark green.
    var dot = (!active && ch.color) ? '<span class="dot" style="background:' + ch.color + '"></span> ' : '';
    var style = '';
    if (active && ch.color) style = ' style="background:' + ch.color + ';border-color:' + ch.color + ';color:' + pillTextColor(ch.color) + '"';
    return '<button class="chip' + (active ? ' active' : '') + '" data-line="' + ch.code + '"' + style + '>' + dot + esc(ch.name) + '</button>';
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
// The station list is the whole app — a transient failure (e.g. a 404 HTML
// page while a deploy is publishing) must never strand the user on a
// dead-end screen: check r.ok before parsing, retry once after a short
// delay (bypassing the HTTP cache on the retry, in case a cached error page
// is the culprit), and only then offer Retry plus a self-heal Reset button.
var STATION_RETRY_MS = 1500;
function loadStations(attempt) {
  var opts = attempt > 0 ? { cache: 'reload' } : {};
  return fetch('stations.json', opts).then(function (r) {
    if (!r.ok) throw new Error('stations.json HTTP ' + r.status);
    return r.json();
  }).catch(function (err) {
    if (attempt < 1) {
      return new Promise(function (resolve) { setTimeout(resolve, STATION_RETRY_MS); })
        .then(function () { return loadStations(attempt + 1); });
    }
    throw err;
  });
}
// Self-heal for a stuck offline state (v16): unregisters the service worker
// and deletes every saved offline cache, then reloads fresh from the
// network. The WMATA key lives in localStorage, which this does NOT touch —
// the key stays saved.
function resetAppData() {
  var done = function () { location.reload(); };
  function clearCaches() {
    if ('caches' in window) {
      return caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      });
    }
    return Promise.resolve();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (r) { return r.unregister(); }));
    }).then(clearCaches).then(done, done);
  } else {
    clearCaches().then(done, done);
  }
}
function showBootError() {
  document.body.innerHTML = '<div style="padding:20px"><p>Could not load the station list — check your connection and try again.</p><p><button id="retryBootBtn" class="primary big" type="button">Retry</button></p><p><button id="resetBootBtn" class="secondary big" type="button">Reset app &amp; reload</button></p><p class="muted">Reset clears the saved offline files and reloads fresh. Your WMATA key stays saved.</p></div>';
  var b = document.getElementById('retryBootBtn');
  if (b) b.addEventListener('click', function () { location.reload(); });
  var r = document.getElementById('resetBootBtn');
  if (r) r.addEventListener('click', resetAppData);
}
loadStations(0).then(function (data) {
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
}).catch(function () { showBootError(); });
