// ----- Configurable API Base -----
const API_KEY = 'tide_api_base';
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
  return path;
}

// ----- State -----
let state = {
  date: '',
  time: '',
  mode: 'S',
  activePoint: null,
  data: null,
  user: null,
  token: null
};

// ----- Auth -----
const AUTH_KEY = 'tide_auth';
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
function loadLocalPoints() {
  try { return JSON.parse(localStorage.getItem('tidePoints') || '[]'); } catch { return []; }
}
function saveLocalPoints(pts) {
  localStorage.setItem('tidePoints', JSON.stringify(pts));
}
let points = loadLocalPoints();
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
const pointsList = document.getElementById('pointsList');
const addPointBtn = document.getElementById('addPointBtn');
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
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCancel = document.getElementById('settingsCancel');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const apiUrlInput = document.getElementById('apiUrlInput');

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
  loadData();
}

function renderPointsBar() {
  pointsList.innerHTML = '';
  points.forEach(function(p) {
    const chip = document.createElement('span');
    chip.className = 'point-chip' + (state.activePoint && state.activePoint.id === p.id ? ' active' : '');
    chip.innerHTML = p.name + ' <span class="del" data-id="' + p.id + '">&times;</span>';
    chip.querySelector('.del').addEventListener('click', function(e) {
      e.stopPropagation();
      deletePoint(p.id);
    });
    chip.addEventListener('click', function() { selectPoint(p); });
    pointsList.appendChild(chip);
  });
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
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
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
    const [currentResp, seriesResp] = await Promise.all([
      fetch(url),
      fetch(apiUrl('/api/current-series?date=' + date + '&mode=' + state.mode + '&lat=' + p.lat + '&lon=' + p.lon))
    ]);

    if (!currentResp.ok) throw new Error('HTTP ' + currentResp.status);
    state.data = await currentResp.json();

    if (seriesResp.ok) {
      state.series = await seriesResp.json();
    } else {
      state.series = null;
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
  tide.highs.forEach(function(h) { events.push({ time: h.time, height: h.height, type: 'high' }); });
  tide.lows.forEach(function(l) { events.push({ time: l.time, height: l.height, type: 'low' }); });
  events.sort(function(a, b) { return a.time.localeCompare(b.time); });
  tideEvents.textContent = events.slice(0, 4).map(function(e) {
    return (e.type === 'high' ? '⬆' : '⬇') + ' ' + e.time + ' ' + e.height.toFixed(2) + 'm';
  }).join(' · ');

  drawTideChart(tide);
  drawSpeedChart(state.series);
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
  const pad = { top: 2, bottom: 10, left: 2, right: 2 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const heights = tide.hours.map(function(h) { return h.height; });
  if (heights.length < 2) { drawTideLabel('暫無數據'); return; }
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const range = maxH - minH || 1;
  const stepX = chartW / (heights.length - 1);

  ctx.clearRect(0, 0, w, h);

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
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < 24; i += 6) {
    const x = pad.left + (i / 23) * chartW;
    ctx.fillText(String(i).padStart(2, '0') + ':00', x, h - 1);
  }

  // Query time indicator (red dot)
  const queryHour = parseInt(hourPicker.value) + parseInt(minPicker.value) / 60;
  if (queryHour >= 0 && queryHour <= 23) {
    const frac = queryHour / 23;
    const x = pad.left + frac * chartW;
    const hIdx = Math.floor(queryHour);
    const hFrac = queryHour - hIdx;
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
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hourPicker.value + ':' + minPicker.value, x, pad.top - 1);
  }
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
  const pad = { top: 2, bottom: 10, left: 2, right: 2 };
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
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  const total = speeds.length; // 96 entries for 24h at 15min intervals
  for (let i = 0; i < total; i += Math.round(total / 4)) {
    const x = pad.left + (i / (total - 1)) * chartW;
    const timeStr = series.series[i] ? series.series[i].time.substring(11, 16) : '';
    ctx.fillText(timeStr, x, h - 1);
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
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hourPicker.value + ':' + minPicker.value, x, pad.top - 1);
  }
}

// ----- Init -----
function init() {
  loadAuth();
  updateLoginUI();

  const now = new Date();
  datePicker.value = now.toISOString().split('T')[0];
  hourPicker.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const opt = document.createElement('option');
    opt.value = String(i).padStart(2, '0');
    opt.textContent = String(i).padStart(2, '0');
    hourPicker.appendChild(opt);
  }
  hourPicker.value = String(now.getHours()).padStart(2, '0');
  const mins = Math.round(now.getMinutes() / 15) * 15;
  minPicker.value = String(mins >= 60 ? 0 : mins).padStart(2, '0');

  // Show initial state on charts
  drawTideLabel('載入中...');
  drawSpeedLabel('載入中...');

  // Auto-select first point if exists
  if (points.length > 0) state.activePoint = points[0];

  // Tide toggle
  const tideInfo = document.getElementById('tideInfo');
  if (tideInfo) {
    tideInfo.classList.remove('hidden');
  }

  // Now button — jump to real-time rounded to nearest 15min
  const nowBtn = document.getElementById('nowBtn');
  if (nowBtn) {
    nowBtn.addEventListener('click', function() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const mins = Math.round(now.getMinutes() / 15) * 15;
      const m = String(mins >= 60 ? 0 : mins).padStart(2, '0');
      hourPicker.value = h;
      minPicker.value = m;
      loadData();
    });
  }

  // Settings modal
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', function() {
      apiUrlInput.value = getApiBase();
      settingsModal.classList.remove('hidden');
    });
    settingsCancel.addEventListener('click', function() { settingsModal.classList.add('hidden'); });
    settingsSaveBtn.addEventListener('click', function() {
      setApiBase(apiUrlInput.value.trim());
      settingsModal.classList.add('hidden');
      if (state.activePoint) loadData();
    });
  }

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
datePicker.addEventListener('change', function() { loadData(); });
hourPicker.addEventListener('change', function() { loadData(); });
minPicker.addEventListener('change', function() { loadData(); });
refreshBtn.addEventListener('click', function() { loadData(); });
modeBtn.addEventListener('click', function() {
  state.mode = state.mode === 'S' ? 'A' : 'S';
  modeBtn.textContent = state.mode === 'S' ? '水面' : '平均';
  modeBtn.classList.toggle('active', state.mode === 'A');
  loadData();
});
addPointBtn.addEventListener('click', function() {
  showAddPointModal(22.38, 113.92);
});
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