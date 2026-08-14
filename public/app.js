// ----- Configurable API Base -----
const API_KEY = 'tideAppApiBase';
function getApiBase() {
  try { return localStorage.getItem(API_KEY) || ''; } catch { return ''; }
}
function setApiBase(url) {
  try {
    if (url) localStorage.setItem(API_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(API_KEY);
  } catch {}
}

function apiUrl(path) {
  const base = getApiBase();
  if (base) return base + path;
  // When deployed on Cloudflare Pages, same-origin
  return path;
}

// ----- Direction helpers -----
const DIR_NAMES = {
  'N': '北', 'NNE': '北北東', 'NE': '東北', 'ENE': '東北東',
  'E': '東', 'ESE': '東南東', 'SE': '東南', 'SSE': '南南東',
  'S': '南', 'SSW': '南南西', 'SW': '西南', 'WSW': '西南西',
  'W': '西', 'WNW': '西北西', 'NW': '西北', 'NNW': '北北西'
};

function degToCompass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Arrow pointing where wind/current is GOING
// - wind: HKO 氣象風向係 FROM，箭嘴要 +180° 指向風吹去嘅方向 (flip=true)
// - current: hydro.gov.hk 水流 direction 本身就係流向，直接用 (flip=false)
function dirToArrow(deg, flip) {
  if (deg == null || isNaN(deg)) return '';
  let d = Math.round(deg) % 360;
  if (flip) d = (d + 180) % 360;
  d = (d + 360) % 360;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(d / 45) % 8];
}

// HKO CSV uses text directions — map to degrees
function hkoWindDirToDeg(dirStr) {
  if (!dirStr || dirStr === '--' || dirStr === 'N/A' || dirStr === 'Calm' || dirStr === 'Variable') return null;
  const map = {
    'North': 0, 'N': 0,
    'North by east': 11.25,
    'NNE': 22.5, 'North-northeast': 22.5, 'North northeast': 22.5,
    'NE by N': 33.75,
    'NE': 45, 'Northeast': 45, 'North-east': 45,
    'NE by E': 56.25,
    'ENE': 67.5, 'East-northeast': 67.5, 'East northeast': 67.5,
    'East by N': 78.75,
    'East': 90, 'E': 90,
    'East by S': 101.25,
    'ESE': 112.5, 'East-southeast': 112.5, 'East southeast': 112.5,
    'SE by E': 123.75,
    'SE': 135, 'Southeast': 135, 'South-east': 135,
    'SE by S': 146.25,
    'SSE': 157.5, 'South-southeast': 157.5, 'South southeast': 157.5,
    'South by E': 168.75,
    'South': 180, 'S': 180,
    'South by W': 191.25,
    'SSW': 202.5, 'South-southwest': 202.5, 'South southwest': 202.5,
    'SW by S': 213.75,
    'SW': 225, 'Southwest': 225, 'South-west': 225,
    'SW by W': 236.25,
    'WSW': 247.5, 'West-southwest': 247.5, 'West southwest': 247.5,
    'West by S': 258.75,
    'West': 270, 'W': 270,
    'West by N': 281.25,
    'WNW': 292.5, 'West-northwest': 292.5, 'West northwest': 292.5,
    'NW by W': 303.75,
    'NW': 315, 'Northwest': 315, 'North-west': 315,
    'NW by N': 326.25,
    'NNW': 337.5, 'North-northwest': 337.5, 'North northwest': 337.5,
    'North by W': 348.75
  };
  // Normalize: lowercase, trim, title-case
  const key = dirStr.trim().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  return map[key] != null ? map[key] : null;
}

// ----- State -----
const WIND_STATION_KEY = 'tideWindStationMap';
let state = {
  date: '',
  time: '',
  mode: 'S',
  activePoint: null,
  data: null,
  series: null,
  weather: null,
  hkoWind: null,
  user: null,
  token: null
};

// Per-point last-picked HKO wind station: { pointIdOrKey: stationName }
let windStationMap = {};
try {
  windStationMap = JSON.parse(localStorage.getItem(WIND_STATION_KEY) || '{}') || {};
} catch (e) { windStationMap = {}; }
function pointWindKey(p) {
  if (!p) return '';
  return p.name + '|' + Math.round(p.lat * 10000) + '|' + Math.round(p.lon * 10000);
}
function saveWindStationMap() {
  try { localStorage.setItem(WIND_STATION_KEY, JSON.stringify(windStationMap)); } catch (e) {}
}

// ----- Auth -----
const AUTH_KEY = '***';
function loadAuth() {
  try {
    const d = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (d && d.token) { state.token = d.token; state.user = d.user; }
  } catch {}
}
function saveAuth() {
  if (state.token) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: state.token, user: state.user }));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}
function clearAuth() {
  state.token = null;
  state.user = null;
  saveAuth();
}

// ----- Saved Points -----
const DEFAULT_POINTS = [
  { id: 'default_1', name: '龍鼓下水點', lat: 22.39, lon: 113.9183, isHydro: false },
  { id: 'default_2', name: '龍鼓水道', lat: 22.3804, lon: 113.9014, isHydro: false },
  { id: 'default_3', name: '大門', lat: 22.1989, lon: 114.2453, isHydro: false }
];
function loadLocalPoints() {
  try { return JSON.parse(localStorage.getItem('tidePoints') || '[]'); } catch { return []; }
}
function saveLocalPoints(pts) {
  localStorage.setItem('tidePoints', JSON.stringify(pts));
}
let points = loadLocalPoints();
if (points.length === 0) points = DEFAULT_POINTS.map(function(p) { return Object.assign({}, p); });
let pointIdCounter = parseInt(localStorage.getItem('tidePointId') || '100');

// ----- Sync with server -----
async function syncPointsToServer() {
  if (!state.token) return;
  try {
    const resp = await fetch(apiUrl('/api/points/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
      body: JSON.stringify({ points: points })
    });
    if (resp.ok) {
      const serverPoints = await resp.json();
      points = serverPoints.map(function(p) { return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, isHydro: false }; });
      // Re-attach activePoint to its server-side twin (ids changed on server)
      if (state.activePoint) {
        const match = points.find(function(p) {
          return p.name === state.activePoint.name &&
            Math.abs(p.lat - state.activePoint.lat) < 0.0001 &&
            Math.abs(p.lon - state.activePoint.lon) < 0.0001;
        });
        if (match) state.activePoint = match;
      }
      saveLocalPoints(points);
      renderPointsBar();
      renderMarkers();
    }
  } catch (e) {
    console.log('Sync failed:', e);
  }
}

async function loadServerPoints() {
  if (!state.token) return;
  try {
    const resp = await fetch(apiUrl('/api/points'), {
      headers: { 'Authorization': 'Bearer ' + state.token }
    });
    if (resp.ok) {
      const serverPoints = await resp.json();
      if (serverPoints.length > 0) {
        points = serverPoints.map(function(p) { return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, isHydro: false }; });
        // Re-attach activePoint to its server-side twin (ids changed on server)
        if (state.activePoint) {
          const match = points.find(function(p) {
            return p.name === state.activePoint.name &&
              Math.abs(p.lat - state.activePoint.lat) < 0.0001 &&
              Math.abs(p.lon - state.activePoint.lon) < 0.0001;
          });
          if (match) state.activePoint = match;
        }
        saveLocalPoints(points);
      }
    }
  } catch (e) {
    console.log('Load server points failed:', e);
  }
}

// ----- DOM refs -----
const datePicker = document.getElementById('datePicker');
const hourPicker = document.getElementById('hourPicker');
const minPicker = document.getElementById('minPicker');
const refreshBtn = document.getElementById('refreshBtn');
const modeBtn = document.getElementById('modeBtn');
const pointsSelect = document.getElementById('pointsSelect');
const addPointBtn = document.getElementById('addPointBtn');
const deletePointBtn = document.getElementById('deletePointBtn');
const moveUpBtn = document.getElementById('moveUpBtn');
const moveDownBtn = document.getElementById('moveDownBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loading = document.getElementById('loading');
const content = document.getElementById('content');
const pointName = document.getElementById('pointName');
const coords = document.getElementById('coords');
const speedVal = document.getElementById('speedVal');
const dirArrow = document.getElementById('dirArrow');
const dirText = document.getElementById('dirText');
const barFill = document.getElementById('barFill');
const hydroPoint = document.getElementById('hydroPoint');
const tideSummary = document.getElementById('tideSummary');
const tideStation = document.getElementById('tideStation');
const tideRange = document.getElementById('tideRange');
const tideEvents = document.getElementById('tideEvents');
const loginModal = document.getElementById('loginModal');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const loginCancel = document.getElementById('loginCancel');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const loginRegisterBtn = document.getElementById('loginRegisterBtn');
const tideCanvas = document.getElementById('tideCanvas');
const speedCanvas = document.getElementById('speedCanvas');
const currentSummary = document.getElementById('currentSummary');
const currentMax = document.getElementById('currentMax');
const currentMin = document.getElementById('currentMin');
const currentPointId = document.getElementById('currentPointId');
const speedToggleBtn = document.getElementById('speedToggleBtn');
const speedInfo = document.getElementById('speedInfo');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');

// ----- Persist last query state (date/time/mode/point/units) -----
const STATE_KEY = 'tideLastState';
function saveState() {
  try {
    const s = {
      date: datePicker.value,
      hour: hourPicker.value,
      min: minPicker.value,
      mode: state.mode,
      pointId: state.activePoint ? state.activePoint.id : null,
      pointName: state.activePoint ? state.activePoint.name : null,
      pointLat: state.activePoint ? state.activePoint.lat : null,
      pointLon: state.activePoint ? state.activePoint.lon : null,
      windUnit: windUnit,
      windHistHours: windHistHours
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch (e) {}
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { return null; }
}
function applyState(s) {
  if (!s) return;
  // 時間唔恢復 — 開 app 永遠用而家時間；只記住 監測點/mode/單位/歷史時段
  if (s.mode === 'S' || s.mode === 'A') {
    state.mode = s.mode;
    modeBtn.textContent = state.mode === 'S' ? '水面' : '平均';
    modeBtn.classList.toggle('active', state.mode === 'A');
  }
  if (s.windUnit === 'kn' || s.windUnit === 'kmh') {
    windUnit = s.windUnit;
    if (windUnitToggle) windUnitToggle.textContent = (windUnit === 'kn') ? 'knot' : 'km/h';
  }
  if (s.windHistHours) {
    // 舊 saved 可能係 168 (7d)，而家冇 7d 選項 — clamp 返做 48h
    windHistHours = (s.windHistHours === 168) ? 48 : s.windHistHours;
    if (windHistRange) windHistRange.textContent = windHistHours + 'h';
  }
  // Point: match by id first, then by name+coords (ids change after server sync)
  if (s.pointId || s.pointName) {
    let match = null;
    if (s.pointId) match = points.find(function(p) { return String(p.id) === String(s.pointId); });
    if (!match && s.pointName != null) {
      match = points.find(function(p) {
        return p.name === s.pointName &&
          Math.abs(p.lat - (s.pointLat || 0)) < 0.0001 &&
          Math.abs(p.lon - (s.pointLon || 0)) < 0.0001;
      });
    }
    if (match) state.activePoint = match;
  }
}

// Wind DOM refs
const windCard = document.getElementById('windCard');
const windUnitToggle = document.getElementById('windUnitToggle');
const windBody = document.getElementById('windBody');
const windStationSelect = document.getElementById('windStationSelect');
const windHkoStation = document.getElementById('windHkoStation');
const windHkoSpeed = document.getElementById('windHkoSpeed');
const windHkoGust = document.getElementById('windHkoGust');
const windHkoDir = document.getElementById('windHkoDir');
const windHkoDirArrow = document.getElementById('windHkoDirArrow');
const windHkoDist = document.getElementById('windHkoDist');
const windHkoTime = document.getElementById('windHkoTime');
const windHkoUnit = document.getElementById('windHkoUnit');
const windHistCanvas = document.getElementById('windHistCanvas');
const windHistInfo = document.getElementById('windHistInfo');
const windHistRange = document.getElementById('windHistRange');
const windHistNote = document.getElementById('windHistNote');
const forecastWindCard = document.getElementById('forecastWindCard');
const forecastWindBody = document.getElementById('forecastWindBody');
const windGfs = document.getElementById('windGfs');
const windEcmwf = document.getElementById('windEcmwf');
let windUnit = 'kmh'; // default km/h

// Warning DOM refs
const warnBar = document.getElementById('warnBar');
const warnChips = document.getElementById('warnChips');

// HKO warning chip colors by code prefix
function warnChipClass(code) {
  if (!code) return '';
  if (code === 'WTC') return 'warn-tc';
  if (code === 'WRAIN') return 'warn-rain';
  if (code === 'WTS') return 'warn-tsr';
  if (code === 'WFLOOD' || code === 'WFO') return 'warn-flood';
  if (code === 'WFIRE') return 'warn-fire';
  if (code === 'WHCO' || code === 'WFROST') return 'warn-cold';
  if (code === 'WHOT') return 'warn-hot';
  return 'warn-other';
}

async function loadWarnings() {
  if (!warnBar || !warnChips) return;
  try {
    const resp = await fetch(apiUrl('/api/warnings?t=' + Date.now()), { cache: 'no-store' });
    if (!resp.ok) { warnBar.classList.add('hidden'); return; }
    const j = await resp.json();
    const list = (j && j.warnings) || [];
    if (list.length === 0) { warnBar.classList.add('hidden'); return; }
    warnChips.innerHTML = '';
    list.forEach(function(w) {
      const chip = document.createElement('span');
      chip.className = 'warn-chip ' + warnChipClass(w.code);
      chip.title = '撳入去睇詳情';
      chip.textContent = '⚠ ' + w.name;
      chip.addEventListener('click', function() { showWarningDetail(w); });
      warnChips.appendChild(chip);
    });
    warnBar.classList.remove('hidden');
  } catch (e) {
    warnBar.classList.add('hidden');
  }
}

// Show full warning text in an in-app modal
function showWarningDetail(w) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const lines = (w.contents && w.contents.length > 0)
    ? w.contents.map(function(t) { return '<p>' + t.replace(/</g, '&lt;') + '</p>'; }).join('')
    : '<p>暫無詳細內容</p>';
  const timeStr = w.updateTime ? w.updateTime.replace('T', ' ').replace('+08:00', '') : '';
  overlay.innerHTML = '\
    <div class="modal warn-modal">\
      <h3>⚠️ ' + w.name + '</h3>\
      <div class="warn-modal-meta">' + (w.code ? w.code + ' · ' : '') + (timeStr ? '更新 ' + timeStr : '') + '</div>\
      <div class="warn-modal-body">' + lines + '</div>\
      <div class="modal-btns">\
        <a class="warn-modal-link" href="https://www.hko.gov.hk/tc/wxinfo/currwx/warn.htm" target="_blank" rel="noopener">天文台網頁 ↗</a>\
        <button class="save" id="warnModalClose">關閉</button>\
      </div>\
    </div>';
  document.body.appendChild(overlay);
  document.getElementById('warnModalClose').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ----- Map -----
let map, markerLayer;

function initMap() {
  map = L.map('map', {
    center: [22.38, 113.92],
    zoom: 13,
    zoomControl: true,
    attributionControl: false
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('click', function(e) {
    showAddPointModal(e.latlng.lat, e.latlng.lng);
  });
  setTimeout(function() {
    // Follow the active monitoring point after refresh
    if (state.activePoint && state.activePoint.lat && state.activePoint.lon) {
      map.setView([state.activePoint.lat, state.activePoint.lon], 12, { animate: false });
    }
    renderMarkers();
    if (state.activePoint) highlightMarker(state.activePoint);
  }, 200);
}

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  points.forEach(function(p) {
    const marker = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: '<div style="background:#1a4a7a;border:2px solid #60b0f4;border-radius:50%;width:12px;height:12px;"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })
    });
    marker.bindTooltip(p.name, { permanent: false, direction: 'top', offset: [0, -8] });
    marker.on('click', function() { selectPoint(p); });
    markerLayer.addLayer(marker);
  });
}

function highlightMarker(point) {
  renderMarkers();
  if (point && markerLayer) {
    L.circle([point.lat, point.lon], {
      radius: 30, color: '#60b0f4', fillColor: 'rgba(96,176,244,0.15)',
      fillOpacity: 0.3, weight: 2
    }).addTo(markerLayer);
  }
}

// ----- Point Management -----
function selectPoint(p) {
  state.activePoint = p;
  renderPointsBar();
  highlightMarker(p);
  if (map && p.lat && p.lon) {
    map.flyTo([p.lat, p.lon], 12, { duration: 0.8 });
  }
  saveState();
  loadData();
}

function renderPointsBar() {
  if (!pointsSelect) return;
  const prev = pointsSelect.value;
  pointsSelect.innerHTML = '';
  if (points.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '選擇一個點...';
    pointsSelect.appendChild(opt);
    pointsSelect.disabled = true;
    return;
  }
  pointsSelect.disabled = false;
  points.forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = p.name;
    pointsSelect.appendChild(opt);
  });
  // Restore or select active point
  if (state.activePoint && points.some(function(p) { return String(p.id) === String(state.activePoint.id); })) {
    pointsSelect.value = String(state.activePoint.id);
  } else if (prev && points.some(function(p) { return String(p.id) === prev; })) {
    pointsSelect.value = prev;
  } else {
    pointsSelect.value = String(points[0].id);
  }
}

function movePoint(dir) {
  if (!state.activePoint) return;
  // Match by name + coords (ids change after server sync, so never rely on id)
  const idx = points.findIndex(function(p) {
    return p.name === state.activePoint.name &&
      Math.abs(p.lat - state.activePoint.lat) < 0.0001 &&
      Math.abs(p.lon - state.activePoint.lon) < 0.0001;
  });
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= points.length) return;
  const item = points.splice(idx, 1)[0];
  points.splice(newIdx, 0, item);
  // Keep activePoint pointing at the moved item
  state.activePoint = item;
  saveLocalPoints(points);
  renderPointsBar();
  renderMarkers();
  syncPointsToServer();
}

function deletePoint(id) {
  if (!confirm('確定刪除「' + (points.find(function(p) { return p.id === id; }) || {name: '?'}).name + '」？')) return;
  points = points.filter(function(p) { return p.id !== id; });
  saveLocalPoints(points);
  if (state.activePoint && state.activePoint.id === id) {
    if (points.length > 0) selectPoint(points[0]);
    else { state.activePoint = null; renderPointsBar(); renderMarkers(); content.classList.add('hidden'); loading.classList.remove('hidden'); loading.textContent = '選擇一個點...'; }
  } else {
    renderPointsBar();
    renderMarkers();
  }
  if (state.token && typeof id === 'number') {
    fetch(apiUrl('/api/points/' + id), { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + state.token } }).catch(function(){});
  }
}

function showAddPointModal(lat, lon) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '\
    <div class="modal">\
      <h3>📍 新增監測點</h3>\
      <label>名稱</label>\
      <input type="text" id="modalName" placeholder="eg. 龍鼓灘西" value="點 ' + (points.length + 1) + '">\
      <label>緯度</label>\
      <input type="number" id="modalLat" step="0.0001" value="' + lat.toFixed(4) + '">\
      <label>經度</label>\
      <input type="number" id="modalLon" step="0.0001" value="' + lon.toFixed(4) + '">\
      <div class="modal-btns">\
        <button class="cancel" id="modalCancel">取消</button>\
        <button class="save" id="modalSave">保存</button>\
      </div>\
    </div>';
  document.body.appendChild(overlay);

  document.getElementById('modalCancel').addEventListener('click', function() { overlay.remove(); });
  document.getElementById('modalSave').addEventListener('click', function() {
    const name = document.getElementById('modalName').value.trim() || ('點 ' + (points.length + 1));
    const lat2 = parseFloat(document.getElementById('modalLat').value);
    const lon2 = parseFloat(document.getElementById('modalLon').value);
    if (isNaN(lat2) || isNaN(lon2)) { alert('請輸入有效坐標'); return; }

    pointIdCounter++;
    localStorage.setItem('tidePointId', String(pointIdCounter));
    const newPoint = { id: 'local_' + pointIdCounter, name: name, lat: lat2, lon: lon2, isHydro: false };
    points.push(newPoint);
    saveLocalPoints(points);
    overlay.remove();
    selectPoint(newPoint);
    syncPointsToServer();
  });
  document.getElementById('modalName').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('modalSave').click();
  });
}

// ----- Login -----
function showLogin() {
  loginModal.classList.remove('hidden');
  loginError.classList.add('hidden');
  loginEmail.value = '';
  loginPassword.value = '';
  // If already logged in, show delete account option instead
  if (state.user && deleteAccountBtn) {
    deleteAccountBtn.classList.remove('hidden');
  }
  loginEmail.focus();
}

function hideLogin() {
  loginModal.classList.add('hidden');
}

function updateLoginUI() {
  if (state.user) {
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    logoutBtn.textContent = state.user.email;
    if (deleteAccountBtn) deleteAccountBtn.classList.remove('hidden');
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    if (deleteAccountBtn) deleteAccountBtn.classList.add('hidden');
  }
}

async function doLogin(email, password) {
  loginError.classList.add('hidden');
  try {
    const resp = await fetch(apiUrl('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    const data = await resp.json();
    if (!resp.ok) { loginError.textContent = data.error; loginError.classList.remove('hidden'); return false; }
    state.token = data.token;
    state.user = data.user;
    saveAuth();
    updateLoginUI();
    hideLogin();
    await loadServerPoints();
    renderPointsBar();
    renderMarkers();
    return true;
  } catch (e) {
    loginError.textContent = 'Network error';
    loginError.classList.remove('hidden');
    return false;
  }
}

async function doRegister(email, password) {
  loginError.classList.add('hidden');
  try {
    const resp = await fetch(apiUrl('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    const data = await resp.json();
    if (!resp.ok) { loginError.textContent = data.error; loginError.classList.remove('hidden'); return false; }
    state.token = data.token;
    state.user = data.user;
    saveAuth();
    updateLoginUI();
    hideLogin();
    await syncPointsToServer();
    return true;
  } catch (e) {
    loginError.textContent = 'Network error';
    loginError.classList.remove('hidden');
    return false;
  }
}

function doLogout() {
  clearAuth();
  updateLoginUI();
  points = loadLocalPoints();
  renderPointsBar();
  renderMarkers();
}

// ----- API -----
async function loadData() {
  if (!state.activePoint) {
    loading.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }
  loading.classList.remove('hidden');
  content.classList.add('hidden');
  drawTideLabel('載入中...');
  drawSpeedLabel('載入中...');
  currentSummary.textContent = '載入中...';

  try {
    const date = datePicker.value;
    const time = hourPicker.value + minPicker.value + '00';
    const p = state.activePoint;

    // Fetch current data
    let url = apiUrl('/api/current?date=' + date + '&time=' + time + '&mode=' + state.mode);
    if (p.lat && p.lon) {
      url += '&lat=' + p.lat + '&lon=' + p.lon;
    }
    const [currentResp, seriesResp, weatherResp, hkoWindResp] = await Promise.all([
      fetch(url),
      fetch(apiUrl('/api/current-series?date=' + date + '&mode=' + state.mode + '&lat=' + p.lat + '&lon=' + p.lon)),
      fetch(apiUrl('/api/weather?lat=' + p.lat + '&lon=' + p.lon + '&date=' + date + '&time=' + time)).catch(function(){ return null; }),
      fetch(apiUrl('/api/hko-wind?lat=' + p.lat + '&lon=' + p.lon)).catch(function(){ return null; })
    ]);

    if (!currentResp.ok) throw new Error('HTTP ' + currentResp.status);
    state.data = await currentResp.json();

    if (seriesResp && seriesResp.ok) {
      state.series = await seriesResp.json();
    } else {
      state.series = null;
    }

    // Forecast wind (GFS + ECMWF) — optional
    if (weatherResp && weatherResp.ok) {
      state.weather = await weatherResp.json();
    } else {
      state.weather = null;
    }

    // HKO real-time wind
    if (hkoWindResp && hkoWindResp.ok) {
      state.hkoWind = await hkoWindResp.json();
    } else {
      state.hkoWind = null;
    }

    render();
  } catch (err) {
    loading.textContent = '⚠️ ' + err.message;
    loading.classList.remove('hidden');
    drawTideLabel('⚠️ ' + err.message);
    drawSpeedLabel('⚠️ ' + err.message);
  }
}

// ----- Render -----
function render() {
  const d = state.data;
  if (!d || d.error) {
    loading.textContent = '⚠️ ' + (d ? d.error : 'No data');
    loading.classList.remove('hidden');
    drawTideLabel('⚠️ 無數據');
    return;
  }
  loading.classList.add('hidden');
  content.classList.remove('hidden');

  const p = state.activePoint;
  const tide = d.tide;

  pointName.textContent = p.name;
  coords.textContent = p.lat.toFixed(4) + '°N, ' + p.lon.toFixed(4) + '°E';

  let nearest = null;
  let nearestDist = Infinity;
  if (d.current) {
    if (d.current.custom) { nearest = d.current.custom; nearestDist = d.current.custom.distance_km; }
    if (!nearest) {
      if (d.current.channel) {
        const d1 = Math.sqrt((d.current.channel.lat - p.lat) ** 2 + (d.current.channel.lon - p.lon) ** 2);
        if (d1 < nearestDist) { nearestDist = d1; nearest = d.current.channel; }
      }
      if (d.current.windsurf) {
        const d2 = Math.sqrt((d.current.windsurf.lat - p.lat) ** 2 + (d.current.windsurf.lon - p.lon) ** 2);
        if (d2 < nearestDist) { nearestDist = d2; nearest = d.current.windsurf; }
      }
      if (d.current.specific) { nearest = d.current.specific; nearestDist = 0; }
    }
  }

  if (nearest) {
    speedVal.textContent = nearest.speed.toFixed(1);
    dirArrow.style.transform = 'rotate(' + nearest.direction + 'deg)';
    dirText.textContent = nearest.compass_cn + ' (' + nearest.direction + '°)';
    const pct = Math.min(100, (nearest.speed / 5) * 100);
    barFill.style.width = pct + '%';
    if (nearest.speed < 1) barFill.style.background = '#4ecdc4';
    else if (nearest.speed < 2) barFill.style.background = '#f7b731';
    else if (nearest.speed < 3.5) barFill.style.background = '#ff6b6b';
    else barFill.style.background = '#e74c3c';
    hydroPoint.textContent = '最近預測點: ' + nearest.point_id + ' (' + nearestDist.toFixed(2) + 'km)';
  } else {
    speedVal.textContent = '--';
    dirText.textContent = '無數據';
    hydroPoint.textContent = '';
  }

  tideSummary.textContent = tide.minHeight + ' - ' + tide.maxHeight + 'm';
  tideStation.textContent = tide.station && tide.station.name ? tide.station.name : '';
  tideRange.textContent = tide.minHeight + ' - ' + tide.maxHeight + 'm (範圍 ' + tide.range + 'm)';

  const events = [];
  if (tide.highs) tide.highs.forEach(function(h) { events.push({ time: h.time, height: h.height, type: 'high' }); });
  if (tide.lows) tide.lows.forEach(function(l) { events.push({ time: l.time, height: l.height, type: 'low' }); });
  events.sort(function(a, b) { return a.time.localeCompare(b.time); });
  tideEvents.innerHTML = events.slice(0, 4).map(function(e) {
    const cls = e.type === 'high' ? 'tide-high' : 'tide-low';
    const arrow = e.type === 'high' ? '⬆' : '⬇';
    return '<span class="' + cls + '">' + arrow + ' ' + e.time + ' ' + e.height.toFixed(2) + 'm</span>';
  }).join(' · ');

  renderHkoWind();
  renderForecastWind();

  drawTideChart(tide);
  drawSpeedChart(state.series);
}

// ----- HKO Real-time Wind -----
function renderHkoWind() {
  if (!windBody || !windHkoSpeed) return;

  // HKO wind CSV is real-time only — only show when selected time is approximately "now"
  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const selectedDate = datePicker.value;
  const selectedMinutes = parseInt(hourPicker.value) * 60 + parseInt(minPicker.value, 10);
  let currentMinutes = now.getHours() * 60 + Math.round(now.getMinutes() / 15) * 15;
  if (currentMinutes >= 1440) currentMinutes -= 1440; // 23:55 → 00:00 wrap
  const isCurrentTime = selectedDate === todayStr && Math.abs(selectedMinutes - currentMinutes) <= 15;

  if (!isCurrentTime) {
    windBody.classList.add('hidden');
    windCard.classList.add('hidden');
    // History chart still works for past/future times (collected data)
    const hw = state.hkoWind;
    if (hw && hw.nearest && hw.nearest.length > 0) loadWindHistory(hw.nearest[0].station);
    return;
  }

  const h = state.hkoWind;
  const nearest = h && h.nearest;

  // If no data or no nearest records, hide
  if (!nearest || !Array.isArray(nearest) || nearest.length === 0) {
    windBody.classList.add('hidden');
    windCard.classList.add('hidden');
    return;
  }

  windBody.classList.remove('hidden');
  windCard.classList.remove('hidden');

  // Populate dropdown
  const prevName = windStationMap[pointWindKey(state.activePoint)] || '';
  windStationSelect.innerHTML = '';
  nearest.forEach(function(stn, i) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = (i + 1) + '. ' + stn.station + ' (' + stn.distance_km.toFixed(1) + 'km)';
    windStationSelect.appendChild(opt);
  });
  // Restore last picked station by NAME (falls back to first if no longer in list)
  let idx = 0;
  if (prevName) {
    const found = nearest.findIndex(function(s) { return s.station === prevName; });
    if (found >= 0) idx = found;
  }
  windStationSelect.value = String(idx);
  windStationMap[pointWindKey(state.activePoint)] = nearest[idx].station;
  saveWindStationMap();

  // Show selected station
  showHkoWindStation(idx);
}

function showHkoWindStation(idx) {
  const h = state.hkoWind;
  if (!h || !h.nearest || !h.nearest[idx]) return;
  const stn = h.nearest[idx];

  const rawSpeed = parseFloat(stn.wind_speed);
  const rawGust = parseFloat(stn.wind_gust);
  const dirStr = stn.wind_dir || '';

  // HKO CSV data is in km/h — convert if showing knots
  const speedKn = isNaN(rawSpeed) ? null : rawSpeed / 1.852;
  const gustKn = isNaN(rawGust) ? null : rawGust / 1.852;
  const speedKmh = isNaN(rawSpeed) ? null : rawSpeed;
  const gustKmh = isNaN(rawGust) ? null : rawGust;

  // Speed
  if (windUnit === 'kn') {
    windHkoSpeed.textContent = speedKn != null ? speedKn.toFixed(1) : '--';
    windHkoUnit.textContent = 'kn';
  } else {
    windHkoSpeed.textContent = speedKmh != null ? Math.round(speedKmh * 10) / 10 + '' : '--';
    windHkoUnit.textContent = 'km/h';
  }

  // Gust
  if (windUnit === 'kn') {
    windHkoGust.textContent = gustKn != null ? gustKn.toFixed(1) + ' kn' : '--';
  } else {
    windHkoGust.textContent = gustKmh != null ? Math.round(gustKmh * 10) / 10 + ' km/h' : '--';
  }

  // Direction — arrow + angle
  const dirDeg = hkoWindDirToDeg(dirStr);
  if (dirDeg != null) {
    const compass = degToCompass(dirDeg);
    // Arrow points direction wind is GOING TO (meteorological FROM + 180°)
    const arrowDeg = (dirDeg + 180) % 360;
    windHkoDir.textContent = DIR_NAMES[compass] + ' (' + dirDeg + '°)';
    if (windHkoDirArrow) {
      windHkoDirArrow.style.transform = 'rotate(' + arrowDeg + 'deg)';
    }
  } else {
    windHkoDir.textContent = dirStr || '--';
  }

  // Station
  // HKO timestamp format is YYYYMMDDHHMM (e.g. 202608120740) — parse directly
  const ts = h.timestamp || '';
  windHkoTime.textContent = ts.length >= 12
    ? ts.substring(8, 10) + ':' + ts.substring(10, 12) + ' (' + ts.substring(4, 6) + '-' + ts.substring(6, 8) + ')'
    : '--';

  // Load history chart for this station
  loadWindHistory(stn.station);
}

// ----- HKO Wind History (collected via cron) -----
let windHistHours = 24;

async function loadWindHistory(station) {
  if (!windHistCanvas) return;
  if (!station) {
    drawWindHistLabel('揀個站先');
    return;
  }
  if (windHistInfo) windHistInfo.textContent = station;
  try {
    const resp = await fetch(apiUrl('/api/wind-history?station=' + encodeURIComponent(station) + '&hours=' + windHistHours));
    if (!resp.ok) {
      drawWindHistLabel('載入失敗 (' + resp.status + ')');
      return;
    }
    const j = await resp.json();
    drawWindHistoryChart(j);
  } catch (e) {
    drawWindHistLabel('載入失敗');
  }
}

function drawWindHistLabel(msg) {
  if (!windHistCanvas) return;
  drawLabel(windHistCanvas, msg);
}

function drawWindHistoryChart(data) {
  if (!windHistCanvas) return;
  const rows = data && data.rows ? data.rows : [];
  if (rows.length < 2) {
    drawWindHistLabel(rows.length === 0 ? '儲數據中... (每10分鐘)' : '數據太少');
    if (windHistNote) windHistNote.textContent = rows.length === 0 ? '而家開始收集，要過一陣先有圖' : '已儲 ' + rows.length + ' 筆';
    return;
  }
  if (windHistNote) windHistNote.textContent = '已儲 ' + data.count + ' 筆 (每10分鐘自動)';

  const ctx = windHistCanvas.getContext('2d');
  const rect = windHistCanvas.parentElement.getBoundingClientRect();
  windHistCanvas.width = rect.width || 300;
  windHistCanvas.height = rect.height || 60;
  const w = windHistCanvas.width, h = windHistCanvas.height;
  if (w < 10 || h < 10) return;
  const pad = { top: 2, bottom: 10, left: 30, right: 2 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  // Convert km/h -> kn if needed (HKO CSV is km/h)
  const toUnit = function(v) {
    if (v == null || isNaN(v)) return null;
    return windUnit === 'kn' ? v / 1.852 : v;
  };
  const speeds = rows.map(function(r) { return toUnit(parseFloat(r.wind_speed)); });
  const valid = speeds.filter(function(v) { return v != null; });
  if (valid.length < 2) { drawWindHistLabel('暫無數據'); return; }
  const minS = Math.min.apply(null, valid);
  const maxS = Math.max.apply(null, valid);
  const range = (maxS - minS) || 1;
  const stepX = chartW / (rows.length - 1);
  const yFor = function(v) { return pad.top + chartH - ((v - minS) / range) * chartH; };

  ctx.clearRect(0, 0, w, h);

  // Y-axis: max / mid / min
  drawYAxis(ctx, pad, chartW, chartH, minS, maxS, function(v) { return windUnit === 'kn' ? v.toFixed(1) : Math.round(v) + ''; });

  // Grid lines
  ctx.strokeStyle = 'rgba(74,90,112,0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
  }

  // Speed area + line
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + chartH);
  speeds.forEach(function(v, i) {
    if (v == null) return;
    ctx.lineTo(pad.left + i * stepX, yFor(v));
  });
  ctx.lineTo(pad.left + (rows.length - 1) * stepX, pad.top + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, 'rgba(78,205,196,0.18)');
  grad.addColorStop(1, 'rgba(78,205,196,0.01)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  speeds.forEach(function(v, i) {
    if (v == null) return;
    const x = pad.left + i * stepX;
    if (i === 0 || speeds[i-1] == null) ctx.moveTo(x, yFor(v));
    else ctx.lineTo(x, yFor(v));
  });
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Time labels (every ~4h)
  ctx.fillStyle = '#4a5a70';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const total = rows.length;
  const labelStep = Math.max(1, Math.round(total / 6));
  for (let i = 0; i < total; i += labelStep) {
    const x = pad.left + (i / (total - 1)) * chartW;
    const dt = rows[i].datetime || '';
    const timeStr = dt.length >= 12 ? dt.substring(8, 10) + ':' + dt.substring(10, 12) : '';
    ctx.fillText(timeStr, x, h - 2);
  }

  // Legend
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4ecdc4';
  ctx.fillText('風速', pad.left + 2, pad.top + 9);
  ctx.fillStyle = '#4a5a70';
  ctx.textAlign = 'right';
  ctx.fillText(windUnit === 'kn' ? 'kn' : 'km/h', pad.left + chartW - 2, pad.top + 9);

  // Store scrub data
  state.scrubData = state.scrubData || {};
  state.scrubData.windhist = rows.map(function(r, i) {
    const v = toUnit(parseFloat(r.wind_speed));
    const dt = r.datetime || '';
    // 風向: HKO CSV 文字方向 → 度數 → 箭嘴 (氣象風向係 FROM，+180° 指向風吹去嘅方向)
    let dirStr = '';
    const dirDeg = hkoWindDirToDeg(r.wind_dir || '');
    if (dirDeg != null) {
      dirStr = ' ' + dirToArrow(dirDeg, true);
    }
    return {
      x: pad.left + (i / (rows.length - 1)) * chartW,
      y: v == null ? null : yFor(v),
      label: dt.length >= 12 ? dt.substring(8, 10) + ':' + dt.substring(10, 12) : '',
      value: v == null ? '--' : (windUnit === 'kn' ? v.toFixed(1) : Math.round(v)) + (windUnit === 'kn' ? ' kn' : ' km/h') + dirStr
    };
  });
  state.scrubData.windhistPad = pad;
  state.scrubData.windhistChartW = chartW;
}

// Range toggle: 12h -> 24h -> 48h -> 12h
function cycleWindHistRange() {
  windHistHours = windHistHours === 12 ? 24 : (windHistHours === 24 ? 48 : 12);
  if (windHistRange) {
    windHistRange.textContent = windHistHours + 'h';
  }
  saveState();
  // Get selected station from dropdown (windHkoStation row was removed)
  let stn = null;
  if (windStationSelect && state.hkoWind && state.hkoWind.nearest) {
    const idx = parseInt(windStationSelect.value);
    if (state.hkoWind.nearest[idx]) stn = state.hkoWind.nearest[idx].station;
  }
  if (stn && stn !== '--') loadWindHistory(stn);
  else if (state.hkoWind && state.hkoWind.nearest && state.hkoWind.nearest.length > 0) {
    loadWindHistory(state.hkoWind.nearest[0].station);
  }
}

// ----- Forecast Wind (GFS + ECMWF) — reference card -----
function renderForecastWind() {
  if (!forecastWindBody || !windGfs || !windEcmwf) return;
  const w = state.weather;
  if (!w) {
    forecastWindBody.classList.add('hidden');
    forecastWindCard.classList.add('hidden');
    return;
  }

  const fmt = function(m) {
    if (!m || m.speed_kn == null) return '--';
    if (windUnit === 'kn') {
      return m.speed_kn.toFixed(1) + ' kn (陣風 ' + m.gust_kn.toFixed(1) + ' kn) ' + (m.compass_cn || m.compass || '');
    } else {
      const kmh = Math.round(m.speed_kn * 1.852 * 10) / 10;
      const gustKmh = m.gust_kn != null ? Math.round(m.gust_kn * 1.852 * 10) / 10 : null;
      return kmh.toFixed(1) + ' km/h' + (gustKmh != null ? ' (陣風 ' + gustKmh.toFixed(1) + ' km/h)' : '') + ' ' + (m.compass_cn || m.compass || '');
    }
  };

  forecastWindBody.classList.remove('hidden');
  forecastWindCard.classList.remove('hidden');
  windGfs.textContent = fmt(w.gfs);
  windEcmwf.textContent = fmt(w.ecmwf);
}

function toggleWindUnit() {
  windUnit = (windUnit === 'kn') ? 'kmh' : 'kn';
  if (windUnitToggle) windUnitToggle.textContent = (windUnit === 'kn') ? 'knot' : 'km/h';
  saveState();
  renderHkoWind();
  renderForecastWind();
}

// ----- Canvas Helpers -----
function drawLabel(canvas, msg) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width || 300;
  canvas.height = rect.height || 60;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#5a6a80';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2 + 4);
}

// Draw Y-axis ticks (max / mid / min) + grid lines
function drawYAxis(ctx, pad, chartW, chartH, minVal, maxVal, fmt) {
  const ticks = [maxVal, (maxVal + minVal) / 2, minVal];
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ticks.forEach(function(v, i) {
    const y = pad.top + (chartH * i) / 2;
    // Grid line
    ctx.strokeStyle = 'rgba(74,90,112,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    // Label (max highlighted)
    ctx.fillStyle = i === 0 ? '#e0a060' : '#4a5a70';
    ctx.fillText(fmt(v), pad.left - 5, y + 3);
  });
}

// ----- Tide Chart -----
function drawTideLabel(msg) { drawLabel(tideCanvas, msg); }

function drawTideChart(tide) {
  if (!tideCanvas) return;
  if (!tide || !tide.hours) { drawTideLabel('暫無數據'); return; }
  const ctx = tideCanvas.getContext('2d');
  const rect = tideCanvas.parentElement.getBoundingClientRect();
  tideCanvas.width = rect.width || 300;
  tideCanvas.height = rect.height || 60;
  const w = tideCanvas.width, h = tideCanvas.height;
  if (w < 10 || h < 10) return;
  const pad = { top: 2, bottom: 10, left: 30, right: 2 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const heights = tide.hours.map(function(h) { return h.height; });
  if (heights.length < 2) { drawTideLabel('暫無數據'); return; }
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const range = maxH - minH || 1;
  const stepX = chartW / (heights.length - 1);

  ctx.clearRect(0, 0, w, h);

  // Y-axis: max / mid / min
  drawYAxis(ctx, pad, chartW, chartH, minH, maxH, function(v) { return v.toFixed(1); });

  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + chartH);
  heights.forEach(function(hVal, i) {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH - ((hVal - minH) / range) * chartH;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + (heights.length - 1) * stepX, pad.top + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, 'rgba(96, 176, 244, 0.15)');
  grad.addColorStop(1, 'rgba(96, 176, 244, 0.01)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  heights.forEach(function(hVal, i) {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH - ((hVal - minH) / range) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#60b0f4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#4a5a70';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < 24; i += 6) {
    const x = pad.left + (i / 23) * chartW;
    ctx.fillText(String(i).padStart(2, '0') + ':00', x, h - 2);
  }

  // Query time indicator (red dot)
  const queryHour = parseInt(hourPicker.value) + parseInt(minPicker.value) / 60;
  if (queryHour >= 0 && queryHour <= 23.99) {
    const clamped = Math.min(queryHour, 23);
    const frac = clamped / 23;
    const x = pad.left + frac * chartW;
    const hIdx = Math.floor(clamped);
    const hFrac = clamped - hIdx;
    const nextIdx = hIdx < 23 ? hIdx + 1 : 23;
    const yVal = heights[hIdx] + (heights[nextIdx] - heights[hIdx]) * hFrac;
    const y = pad.top + chartH - ((yVal - minH) / range) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b6b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,107,107,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Label
    ctx.fillStyle = '#ff6b6b';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hourPicker.value + ':' + minPicker.value, x, pad.top - 1);
  }

  // Store scrub data (for hover/drag value display)
  state.scrubData = state.scrubData || {};
  state.scrubData.tide = heights.map(function(hVal, i) {
    return {
      x: pad.left + i * stepX,
      y: pad.top + chartH - ((hVal - minH) / range) * chartH,
      label: String(i).padStart(2, '0') + ':00',
      value: hVal.toFixed(2) + ' m'
    };
  });
  state.scrubData.tidePad = pad;
  state.scrubData.tideChartW = chartW;
}

// ----- Speed Chart -----
function drawSpeedLabel(msg) { drawLabel(speedCanvas, msg); }

function drawSpeedChart(series) {
  if (!speedCanvas) return;
  if (!series || !series.series || series.series.length < 2) { drawSpeedLabel('暫無數據'); return; }

  const ctx = speedCanvas.getContext('2d');
  const rect = speedCanvas.parentElement.getBoundingClientRect();
  speedCanvas.width = rect.width || 300;
  speedCanvas.height = rect.height || 60;
  const w = speedCanvas.width, h = speedCanvas.height;
  if (w < 10 || h < 10) return;
  const pad = { top: 2, bottom: 10, left: 30, right: 2 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  // Parse series: each entry has {time, speed, direction}
  const speeds = series.series.map(function(s) { return s.speed; });
  if (speeds.length < 2) { drawSpeedLabel('暫無數據'); return; }

  const minS = Math.min(...speeds);
  const maxS = Math.max(...speeds);
  const range = maxS - minS || 1;
  const stepX = chartW / (speeds.length - 1);

  // Update summary
  currentSummary.textContent = series.mode + ' (' + series.point_id + ')';
  currentMax.textContent = maxS.toFixed(2) + ' knots';
  currentMin.textContent = minS.toFixed(2) + ' knots';
  currentPointId.textContent = series.point_id;

  ctx.clearRect(0, 0, w, h);

  // Y-axis: max / mid / min
  drawYAxis(ctx, pad, chartW, chartH, minS, maxS, function(v) { return v.toFixed(1); });

  // Fill area
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + chartH);
  speeds.forEach(function(sVal, i) {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH - ((sVal - minS) / range) * chartH;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + (speeds.length - 1) * stepX, pad.top + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, 'rgba(78, 205, 196, 0.15)');
  grad.addColorStop(1, 'rgba(78, 205, 196, 0.01)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  speeds.forEach(function(sVal, i) {
    const x = pad.left + i * stepX;
    const y = pad.top + chartH - ((sVal - minS) / range) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Time labels (every 6 hours)
  ctx.fillStyle = '#4a5a70';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const total = speeds.length; // 96 entries for 24h at 15min intervals
  for (let i = 0; i < total; i += Math.round(total / 4)) {
    const x = pad.left + (i / (total - 1)) * chartW;
    const timeStr = series.series[i] ? series.series[i].time.substring(11, 16) : '';
    ctx.fillText(timeStr, x, h - 2);
  }

  // Query time indicator (red dot)
  const queryMinutes = parseInt(hourPicker.value) * 60 + parseInt(minPicker.value);
  const frac = queryMinutes / (24 * 60);
  if (frac >= 0 && frac <= 1) {
    const x = pad.left + frac * chartW;
    const idx = Math.floor(frac * (speeds.length - 1));
    const idxFrac = (frac * (speeds.length - 1)) - idx;
    const nextIdx = Math.min(idx + 1, speeds.length - 1);
    const yVal = speeds[idx] + (speeds[nextIdx] - speeds[idx]) * idxFrac;
    const y = pad.top + chartH - ((yVal - minS) / range) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b6b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,107,107,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Label
    ctx.fillStyle = '#ff6b6b';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hourPicker.value + ':' + minPicker.value, x, pad.top - 1);
  }

  // Store scrub data
  state.scrubData = state.scrubData || {};
  state.scrubData.speed = speeds.map(function(sVal, i) {
    // 流向: series 每點有 direction (度數)，本身已經係流向，唔使 flip
    const dir = series.series[i] ? series.series[i].direction : null;
    const dirStr = (dir != null && !isNaN(dir)) ? ' ' + dirToArrow(dir, false) : '';
    return {
      x: pad.left + (i / (speeds.length - 1)) * chartW,
      y: pad.top + chartH - ((sVal - minS) / range) * chartH,
      label: series.series[i] ? series.series[i].time.substring(11, 16) : '',
      value: sVal.toFixed(2) + ' kn' + dirStr
    };
  });
  state.scrubData.speedPad = pad;
  state.scrubData.speedChartW = chartW;
}

// ----- Chart Scrub (hover/drag to show value) -----
const chartTooltip = document.getElementById('chartTooltip');
let scrubCanvas = null;

function attachScrub(canvas, key) {
  if (!canvas) return;
  canvas.addEventListener('pointerdown', function(e) {
    scrubCanvas = canvas;
    canvas.setPointerCapture(e.pointerId);
    scrubShow(e, key);
  });
  // Hover AND drag both show the value
  canvas.addEventListener('pointermove', function(e) {
    scrubCanvas = canvas;
    scrubShow(e, key);
  });
  canvas.addEventListener('pointerup', scrubHide);
  canvas.addEventListener('pointerleave', scrubHide);
  canvas.addEventListener('pointercancel', scrubHide);
}

function scrubShow(e, key) {
  if (!chartTooltip) return;
  const d = state.scrubData && state.scrubData[key];
  if (!d || d.length === 0) return;
  const rect = e.target.getBoundingClientRect();
  const scaleX = e.target.width / (rect.width || 1);
  const x = (e.clientX - rect.left) * scaleX;
  const padKey = key + 'Pad';
  const pad = state.scrubData[padKey];
  if (pad && (x < pad.left || x > pad.left + state.scrubData[key + 'ChartW'])) return;
  // Nearest point
  let best = 0, bestD = Infinity;
  d.forEach(function(p, i) {
    const dist = Math.abs(p.x - x);
    if (dist < bestD) { bestD = dist; best = i; }
  });
  const p = d[best];
  chartTooltip.textContent = (p.label ? p.label + '  ' : '') + p.value;
  chartTooltip.style.display = 'block';
  // 放喺手指上方 (高過手指 ~80px)，唔會被遮住；水平置中
  const tw = chartTooltip.offsetWidth;
  const th = chartTooltip.offsetHeight;
  let tx = e.clientX - tw / 2;
  let ty = e.clientY - 80;
  if (tx < 8) tx = 8;
  if (tx + tw > window.innerWidth - 8) tx = window.innerWidth - tw - 8;
  // 頂位唔夠就放手指下方
  if (ty < 4) ty = e.clientY + 30;
  if (ty + th > window.innerHeight - 8) ty = window.innerHeight - th - 8;
  chartTooltip.style.left = tx + 'px';
  chartTooltip.style.top = ty + 'px';
}

function scrubHide() {
  scrubCanvas = null;
  if (chartTooltip) chartTooltip.style.display = 'none';
}

// ----- Init -----
function init() {
  loadAuth();
  updateLoginUI();

  const now = new Date();
  datePicker.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  hourPicker.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const opt = document.createElement('option');
    opt.value = String(i).padStart(2, '0');
    opt.textContent = String(i).padStart(2, '0');
    hourPicker.appendChild(opt);
  }
  let mins = Math.round(now.getMinutes() / 15) * 15;
  let hrs = now.getHours();
  if (mins >= 60) { mins = 0; hrs = (hrs + 1) % 24; }
  hourPicker.value = String(hrs).padStart(2, '0');
  minPicker.value = String(mins).padStart(2, '0');

  // Restore last query state (date/time/mode/point/units) — 開 link 自動回到上次查詢
  applyState(loadState());

  // Show initial state on charts
  drawTideLabel('載入中...');
  drawSpeedLabel('載入中...');

  // Auto-select first point if exists (unless restored from saved state)
  if (points.length > 0 && !state.activePoint) state.activePoint = points[0];

  // Tide toggle
  const tideInfo = document.getElementById('tideInfo');
  if (tideInfo) {
    tideInfo.classList.remove('hidden');
  }

  // Delete account (註銷帳號) — shown in login modal when logged in
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async function() {
      if (!state.token) return;
      const email = state.user && state.user.email ? state.user.email : '此帳號';
      if (!confirm('確定註銷帳號「' + email + '」？\n會刪除所有 saved points，且無法復原！')) return;
      try {
        const resp = await fetch(apiUrl('/api/account'), {
          method: 'DELETE',
          headers: { 'Authorization': '***' + state.token }
        });
        if (resp.ok) {
          loginModal.classList.add('hidden');
          clearAuth();
          updateLoginUI();
          points = DEFAULT_POINTS.map(function(p) { return Object.assign({}, p); });
          saveLocalPoints(points);
          renderPointsBar();
          renderMarkers();
          if (state.activePoint) loadData();
        } else {
          const j = await resp.json().catch(function(){ return {}; });
          alert('註銷失敗: ' + (j.error || resp.status));
        }
      } catch (e) {
        alert('註銷失敗: ' + e.message);
      }
    });
  }

  // Wind unit toggle
  if (windUnitToggle) {
    windUnitToggle.addEventListener('click', toggleWindUnit);
  }

  // HKO warning signals (top bar) — load now + refresh every 5 min
  loadWarnings();
  setInterval(loadWarnings, 5 * 60 * 1000);

  // Wind history range toggle (12h / 24h / 48h)
  if (windHistRange) {
    windHistRange.addEventListener('click', cycleWindHistRange);
  }
  // Wind station dropdown change
  if (windStationSelect) {
    windStationSelect.addEventListener('change', function() {
      const idx = parseInt(windStationSelect.value);
      const h = state.hkoWind;
      if (h && h.nearest && h.nearest[idx]) {
        windStationMap[pointWindKey(state.activePoint)] = h.nearest[idx].station;
        saveWindStationMap();
      }
      showHkoWindStation(idx);
    });
  }

  // Chart scrub (hover/drag to show value)
  attachScrub(tideCanvas, 'tide');
  attachScrub(speedCanvas, 'speed');
  attachScrub(windHistCanvas, 'windhist');

  // Speed toggle
  if (speedToggleBtn && speedInfo) {
    speedToggleBtn.addEventListener('click', function() {
      const showing = !speedInfo.classList.contains('hidden');
      speedInfo.classList.toggle('hidden');
      speedToggleBtn.textContent = showing ? '▼ 詳情' : '▲ 收起';
    });
  }

  // If logged in, load server points first
  if (state.token) {
    loadServerPoints().then(function() {
      renderPointsBar();
      initMap();
      loadData();
    });
  } else {
    renderPointsBar();
    initMap();
    loadData();
  }
}

// ----- Events -----
datePicker.addEventListener('change', function() { saveState(); loadData(); });
hourPicker.addEventListener('change', function() { saveState(); loadData(); });
minPicker.addEventListener('change', function() { saveState(); loadData(); });
refreshBtn.addEventListener('click', function() { loadData(); });
modeBtn.addEventListener('click', function() {
  state.mode = state.mode === 'S' ? 'A' : 'S';
  modeBtn.textContent = state.mode === 'S' ? '水面' : '平均';
  modeBtn.classList.toggle('active', state.mode === 'A');
  saveState();
  loadData();
});
addPointBtn.addEventListener('click', function() {
  showAddPointModal(22.38, 113.92);
});
pointsSelect.addEventListener('change', function() {
  const id = pointsSelect.value;
  const p = points.find(function(x) { return String(x.id) === String(id); });
  if (p) selectPoint(p);
});
deletePointBtn.addEventListener('click', function() {
  if (state.activePoint) deletePoint(state.activePoint.id);
});
moveUpBtn.addEventListener('click', function() { movePoint(-1); });
moveDownBtn.addEventListener('click', function() { movePoint(1); });
loginBtn.addEventListener('click', showLogin);
logoutBtn.addEventListener('click', doLogout);
loginCancel.addEventListener('click', hideLogin);
loginSubmitBtn.addEventListener('click', function() {
  doLogin(loginEmail.value, loginPassword.value);
});
loginRegisterBtn.addEventListener('click', function() {
  if (loginPassword.value.length < 4) {
    loginError.textContent = '密碼最少4位';
    loginError.classList.remove('hidden');
    return;
  }
  doRegister(loginEmail.value, loginPassword.value);
});
loginEmail.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loginPassword.focus();
});
loginPassword.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loginSubmitBtn.click();
});

// Resize handler for charts
let resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    if (state.data && state.data.tide) drawTideChart(state.data.tide);
    if (state.series) drawSpeedChart(state.series);
  }, 200);
});

document.addEventListener('DOMContentLoaded', init);