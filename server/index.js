const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'tide-app-secret-2026';

// ----- CORS (allow GitHub Pages) -----
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ----- SQLite (local) -----
const db = new Database(path.join(__dirname, 'tideapp.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

console.log('DB tables ready (SQLite)');

// ----- Middleware -----
app.use(express.static(path.join(__dirname, '..')));
app.use(express.json());

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ----- Auth API -----
app.post('/api/register', async function(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password too short' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hash);
    const userId = result.lastInsertRowid;
    const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: userId, email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async function(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Points API -----
app.get('/api/points', authMiddleware, function(req, res) {
  try {
    const points = db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY created_at').all(req.user.id);
    res.json(points);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/points', authMiddleware, function(req, res) {
  try {
    const { name, lat, lon } = req.body;
    if (!name || lat == null || lon == null) return res.status(400).json({ error: 'name, lat, lon required' });

    const result = db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)').run(req.user.id, name, lat, lon);
    res.json({ id: result.lastInsertRowid, name, lat, lon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/points/:id', authMiddleware, function(req, res) {
  try {
    const result = db.prepare('DELETE FROM points WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Point not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/points/sync', authMiddleware, function(req, res) {
  try {
    const { points: clientPoints } = req.body;
    if (!Array.isArray(clientPoints)) return res.status(400).json({ error: 'points array required' });

    const del = db.prepare('DELETE FROM points WHERE user_id = ?');
    const ins = db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction(function() {
      del.run(req.user.id);
      for (const p of clientPoints) {
        ins.run(req.user.id, p.name, p.lat, p.lon);
      }
    });
    transaction();

    const points = db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY id').all(req.user.id);
    res.json(points);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Default headers for hydro.gov.hk -----
const HYDRO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const HYDRO_HEADERS = {
  'User-Agent': HYDRO_UA,
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://current.hydro.gov.hk/main/prediction_static.php?lang=en'
};

// ----- Cache -----
const TIDE_TTL = 60 * 60 * 1000;
let hydroCache = {};
const HYDRO_TTL = 15 * 60 * 1000;



// ----- Hydro Current (GeoJSON) -----
async function fetchHydroCurrents(time, mode) {
  const cacheKey = time + '_' + mode;
  if (hydroCache[cacheKey] && hydroCache[cacheKey].ts > Date.now() - HYDRO_TTL) {
    return hydroCache[cacheKey].data;
  }
  const url = 'https://current.hydro.gov.hk/data/static_geojson.php?time=' + time + '&mode=' + mode;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: HYDRO_HEADERS });
      const text = await resp.text();
      if (text && text.length > 0) {
        const data = JSON.parse(text);
        hydroCache[cacheKey] = { data: data, ts: Date.now() };
        return data;
      }
    } catch (e) {
      console.log('Hydro fetch attempt ' + (attempt + 1) + ' failed: ' + e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Hydro.gov.hk 暫時無法連線，請稍後再試');
}

// ----- Find nearest point -----
function findNearest(geojson, lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const f of geojson.features) {
    const coords = f.geometry.coordinates;
    const d = Math.sqrt((coords[1] - lat) ** 2 + (coords[0] - lon) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = {
        point_id: f.properties.point_id,
        lat: Math.round(coords[1] * 10000) / 10000,
        lon: Math.round(coords[0] * 10000) / 10000,
        speed: parseFloat(f.properties.knot),
        direction: parseFloat(f.properties.deg),
        distance_km: Math.round(d * 111 * 100) / 100
      };
    }
  }
  return best;
}

// ----- Process tide data -----
function processTideData(rawData, targetDate) {
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateKey = month + day;
  const todayData = rawData[dateKey];
  if (!todayData) return { error: 'No tide data for ' + dateKey };

  const highs = [], lows = [];
  for (let h = 1; h < 23; h++) {
    if (todayData[h] > todayData[h - 1] && todayData[h] > todayData[h + 1])
      highs.push({ hour: h, height: Math.round(todayData[h] * 100) / 100 });
    if (todayData[h] < todayData[h - 1] && todayData[h] < todayData[h + 1])
      lows.push({ hour: h, height: Math.round(todayData[h] * 100) / 100 });
  }
  if (todayData[0] > todayData[1]) highs.push({ hour: 0, height: Math.round(todayData[0] * 100) / 100 });
  if (todayData[0] < todayData[1]) lows.push({ hour: 0, height: Math.round(todayData[0] * 100) / 100 });
  if (todayData[23] > todayData[22]) highs.push({ hour: 23, height: Math.round(todayData[23] * 100) / 100 });
  if (todayData[23] < todayData[22]) lows.push({ hour: 23, height: Math.round(todayData[23] * 100) / 100 });

  const fmtTime = (h) => String(h).padStart(2, '0') + ':00';
  const minH = Math.min(...todayData);
  const maxH = Math.max(...todayData);

  return {
    date: targetDate.getFullYear() + '-' + month + '-' + day,
    minHeight: Math.round(minH * 100) / 100,
    maxHeight: Math.round(maxH * 100) / 100,
    range: Math.round((maxH - minH) * 100) / 100,
    highs: highs.map(h => ({ hour: h.hour, height: h.height, time: fmtTime(h.hour) })),
    lows: lows.map(h => ({ hour: h.hour, height: h.height, time: fmtTime(h.hour) })),
    hours: todayData.map((h, i) => ({ hour: i, height: Math.round(h * 100) / 100, time: fmtTime(i) }))
  };
}

// ----- HKO Tide Stations (12 stations from HKO tide tables) -----
const HKO_STATIONS = {
  'CLK': { name: '赤鱲角東 (Chek Lap Kok E)', lat: 22.300, lon: 113.933 },
  'CCW': { name: '長洲 (Cheung Chau)', lat: 22.208, lon: 114.027 },
  'KLW': { name: '高流灣 (Ko Lau Wan)', lat: 22.533, lon: 114.283 },
  'KWC': { name: '葵涌 (Kwai Chung)', lat: 22.350, lon: 114.117 },
  'MW':  { name: '馬灣 (Ma Wan)', lat: 22.350, lon: 114.067 },
  'QBY': { name: '鰂魚涌 (Quarry Bay)', lat: 22.283, lon: 114.217 },
  'SPK': { name: '石壁 (Shek Pik)', lat: 22.217, lon: 113.883 },
  'TMW': { name: '大廟灣 (Tai Miu Wan)', lat: 22.317, lon: 114.300 },
  'TAO': { name: '大澳 (Tai O)', lat: 22.250, lon: 113.850 },
  'TPK': { name: '大埔滘 (Tai Po Kau)', lat: 22.433, lon: 114.167 },
  'TBT': { name: '尖鼻咀 (Tsim Bei Tsui)', lat: 22.483, lon: 114.000 },
  'WAG': { name: '橫瀾島 (Waglan Island)', lat: 22.182, lon: 114.303 }
};

function findNearestHKO(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const [code, stn] of Object.entries(HKO_STATIONS)) {
    const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = { code: code, name: stn.name, lat: stn.lat, lon: stn.lon, distance_km: Math.round(d * 111 * 100) / 100 };
    }
  }
  return best;
}

async function findNearestValidHKO(lat, lon) {
  const stations = [];
  for (const [code, stn] of Object.entries(HKO_STATIONS)) {
    const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
    stations.push({
      code: code,
      name: stn.name,
      lat: stn.lat,
      lon: stn.lon,
      distance_km: Math.round(d * 111 * 100) / 100
    });
  }
  stations.sort((a, b) => a.distance_km - b.distance_km);

  let lastError = null;
  for (const stn of stations) {
    try {
      console.log('Trying tide station ' + stn.code + ' (' + stn.name + '), ' + stn.distance_km + 'km away');
      const data = await getTideData(stn.code);
      return { station: stn, tideRaw: data };
    } catch (err) {
      lastError = err;
      console.log('Station ' + stn.code + ' failed: ' + err.message + ', trying next...');
    }
  }

  throw new Error(lastError || 'No valid HKO tide station found');
}

// HKO tide fetch with station code
async function fetchTideDataStation(year, stationCode) {
  const url = 'https://www.hko.gov.hk/tide/' + stationCode + 'textPH' + year + '.htm';
  const resp = await fetch(url, { headers: { 'User-Agent': HYDRO_UA } });
  if (!resp.ok) throw new Error('HKO returned ' + resp.status + ' for ' + stationCode);
  const html = await resp.text();

  const data = {};
  const rows = html.split(/<TR>/i);
  for (const row of rows) {
    const tds = row.match(/<TD[^>]*>([^<]*)<\/TD>/gi);
    if (!tds || tds.length < 26) continue;
    const month = tds[0].replace(/<[^>]*>/g, '').trim();
    const day = tds[1].replace(/<[^>]*>/g, '').trim();
    const monthNum = parseInt(month, 10);
    const dayNum = parseInt(day, 10);
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12 || isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;
    const dateKey = String(monthNum).padStart(2, '0') + String(dayNum).padStart(2, '0');
    const values = [];
    for (let i = 2; i < tds.length; i++) {
      const val = parseFloat(tds[i].replace(/<[^>]*>/g, '').trim());
      if (!isNaN(val)) values.push(val);
    }
    if (values.length === 24) data[dateKey] = values;
  }
  if (Object.keys(data).length === 0) throw new Error('Failed to parse tide data for ' + stationCode);
  return data;
}

// Multi-station tide cache
let tideCacheMap = {};

function getTideCacheKey(stationCode) {
  return stationCode + '_' + new Date().getFullYear();
}

async function getTideData(stationCode) {
  const key = getTideCacheKey(stationCode);
  const cached = tideCacheMap[key];
  if (cached && cached.ts > Date.now() - TIDE_TTL) {
    return cached.data;
  }
  const data = await fetchTideDataStation(new Date().getFullYear(), stationCode);
  tideCacheMap[key] = { data: data, ts: Date.now() };
  return data;
}

// ----- Open-Meteo tide (MSL reference, coordinate-based) -----
let openMeteoTideCache = {};

async function fetchOpenMeteoTide(lat, lon) {
  const key = lat.toFixed(2) + '_' + lon.toFixed(2);
  if (openMeteoTideCache[key] && openMeteoTideCache[key].ts > Date.now() - TIDE_TTL) {
    return openMeteoTideCache[key].data;
  }
  const today = new Date();
  const startDate = today.toISOString().split('T')[0];
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const endDate = end.toISOString().split('T')[0];

  const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat +
    '&longitude=' + lon +
    '&hourly=sea_level_height_msl' +
    '&start_date=' + startDate + '&end_date=' + endDate +
    '&timezone=Asia/Hong_Kong';

  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Open-Meteo returned ' + resp.status);
  const json = await resp.json();
  if (!json.hourly || !json.hourly.time || !json.hourly.sea_level_height_msl) {
    throw new Error('Open-Meteo no tide data for ' + lat + ',' + lon);
  }

  // Convert to { 'MMDD': [24 values] } format (same as HKO) for each day
  const data = {};
  const times = json.hourly.time;
  const heights = json.hourly.sea_level_height_msl;
  let currentKey = null;
  let currentVals = [];
  for (let i = 0; i < times.length; i++) {
    const key_ = times[i].substring(5, 7) + times[i].substring(8, 10); // MMDD
    if (currentKey !== key_) {
      if (currentKey && currentVals.length === 24) data[currentKey] = currentVals;
      currentKey = key_;
      currentVals = [];
    }
    currentVals.push(heights[i]);
  }
  if (currentKey && currentVals.length === 24) data[currentKey] = currentVals;

  if (Object.keys(data).length === 0) throw new Error('No tide days parsed');
  openMeteoTideCache[key] = { data: data, ts: Date.now() };
  return data;
}

// ----- Weather API (GFS + ECMWF wind) -----
let weatherCache = {};
const WEATHER_TTL = 15 * 60 * 1000;

async function fetchWeather(lat, lon, dateStr, timeStr) {
  const key = lat.toFixed(2) + '_' + lon.toFixed(2) + '_' + (dateStr || 'today') + '_' + (timeStr || 'now');
  if (weatherCache[key] && weatherCache[key].ts > Date.now() - WEATHER_TTL) {
    return weatherCache[key].data;
  }

  // Use the requested date (if available) or today
  const today = new Date();
  const reqDate = dateStr || today.toISOString().split('T')[0];

  const base = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&start_date=' + reqDate + '&end_date=' + reqDate +
    '&timezone=Asia/Hong_Kong&wind_speed_unit=kn';

  const [gfsResp, ecmwfResp] = await Promise.all([
    fetch(base + '&models=gfs_seamless'),
    fetch(base + '&models=ecmwf_ifs')
  ]);

  let gfs, ecmwf;
  if (gfsResp.ok) {
    gfs = await gfsResp.json();
  } else {
    console.log('GFS Open-Meteo error: ' + gfsResp.status + ' ' + (await gfsResp.text()).substring(0, 100));
    gfs = {};
  }
  if (ecmwfResp.ok) {
    ecmwf = await ecmwfResp.json();
  } else {
    console.log('ECMWF Open-Meteo error: ' + ecmwfResp.status + ' ' + (await ecmwfResp.text()).substring(0, 100));
    ecmwf = {};
  }

  const pick = (j) => {
    // Find the right hour index
    const times = j.hourly && j.hourly.time || [];
    const speeds = j.hourly && j.hourly.wind_speed_10m || [];
    const gusts = j.hourly && j.hourly.wind_gusts_10m || [];
    const dirs = j.hourly && j.hourly.wind_direction_10m || [];

    // If no data returned for this date, return null
    if (times.length === 0) return null;

    let idx = -1;
    if (timeStr && times.length > 0) {
      const targetHour = parseInt(timeStr.substring(0, 2), 10);
      const targetMin = parseInt(timeStr.substring(2, 4), 10);
      // Find the closest time slot
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const h = parseInt(t.substring(11, 13), 10);
        const m = parseInt(t.substring(14, 16), 10);
        if (h === targetHour && m === targetMin) { idx = i; break; }
        if (h === targetHour && m <= targetMin) { idx = i; }
      }
      if (idx < 0) idx = 0;
    } else {
      idx = 0;
    }

    const speed = idx >= 0 && idx < speeds.length ? speeds[idx] : null;
    const gust = idx >= 0 && idx < gusts.length ? gusts[idx] : null;
    const dir = idx >= 0 && idx < dirs.length ? dirs[idx] : null;

    return {
      speed_kn: speed != null ? Math.round(speed * 10) / 10 : null,
      gust_kn: gust != null ? Math.round(gust * 10) / 10 : null,
      direction: dir != null ? Math.round(dir) : null,
      compass: dir != null ? degToCompass(dir) : null,
      compass_cn: dir != null ? (DIR_NAMES[degToCompass(dir)] || String(Math.round(dir))) : null
    };
  };

  const data = { gfs: pick(gfs), ecmwf: pick(ecmwf) };
  weatherCache[key] = { data: data, ts: Date.now() };
  return data;
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

function roundTime(timeStr) {
  const h = timeStr.substring(0, 2);
  const m = parseInt(timeStr.substring(2, 4));
  const rounded = Math.round(m / 15) * 15;
  if (rounded >= 60) {
    const nextH = String(parseInt(h) + 1).padStart(2, '0');
    return nextH + '00' + '00';
  }
  return h + String(rounded).padStart(2, '0') + '00';
}

// ----- API: Combined data -----
app.get('/api/current', async function(req, res) {
  try {
    const now = new Date();
    const year = now.getFullYear();

    const reqDate = req.query.date || (year + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'));
    const rawTime = req.query.time || (String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '00');
    const reqTime = roundTime(rawTime);
    const reqMode = req.query.mode || 'S';
    const reqPoint = req.query.point || null;
    const reqLat = req.query.lat ? parseFloat(req.query.lat) : null;
    const reqLon = req.query.lon ? parseFloat(req.query.lon) : null;

    const hydroTime = reqDate.replace(/-/g, '') + reqTime;

    // Find nearest valid HKO tide station as fallback
    const lat2 = reqLat || 22.38;
    const lon2 = reqLon || 113.90;

    let tideRaw, tideStation;
    try {
      // Open-Meteo first (coordinate-based, no 404 issue)
      tideRaw = await fetchOpenMeteoTide(lat2, lon2);
      tideStation = { code: 'OPENMETEO', name: 'Open-Meteo (模型)', lat: lat2, lon: lon2, distance_km: 0 };
    } catch (e) {
      console.log('Open-Meteo tide failed, fallback to HKO:', e.message);
      // HKO fallback
      const { station, tideRaw: hkoRaw } = await findNearestValidHKO(lat2, lon2);
      tideRaw = hkoRaw;
      tideStation = station;
    }

    const targetDate = new Date(reqDate + 'T' + reqTime.substring(0, 2) + ':' + reqTime.substring(2, 4) + ':00');
    const tide = processTideData(tideRaw, targetDate);
    tide.station = tideStation;

    const geojson = await fetchHydroCurrents(hydroTime, reqMode);

    const channelPoint = findNearest(geojson, 22.39, 113.918);
    const windsurfPoint = findNearest(geojson, 22.38, 113.9003);

    let customPoint = null;
    if (reqLat && reqLon) {
      customPoint = findNearest(geojson, reqLat, reqLon);
    }

    let specificPoint = null;
    if (reqPoint) {
      for (const f of geojson.features) {
        if (f.properties.point_id == reqPoint) {
          specificPoint = {
            point_id: f.properties.point_id,
            lat: Math.round(f.geometry.coordinates[1] * 10000) / 10000,
            lon: Math.round(f.geometry.coordinates[0] * 10000) / 10000,
            speed: parseFloat(f.properties.knot),
            direction: parseFloat(f.properties.deg),
            distance_km: 0
          };
          break;
        }
      }
    }

    res.json({
      time: hydroTime,
      mode: reqMode === 'S' ? 'Surface (水面)' : 'Average (平均)',
      tide: tide,
      current: {
        channel: channelPoint ? { ...channelPoint, compass: degToCompass(channelPoint.direction), compass_cn: DIR_NAMES[degToCompass(channelPoint.direction)] || channelPoint.direction } : null,
        windsurf: windsurfPoint ? { ...windsurfPoint, compass: degToCompass(windsurfPoint.direction), compass_cn: DIR_NAMES[degToCompass(windsurfPoint.direction)] || windsurfPoint.direction } : null,
        specific: specificPoint ? { ...specificPoint, compass: degToCompass(specificPoint.direction), compass_cn: DIR_NAMES[degToCompass(specificPoint.direction)] || specificPoint.direction } : null,
        custom: customPoint ? { ...customPoint, compass: degToCompass(customPoint.direction), compass_cn: DIR_NAMES[degToCompass(customPoint.direction)] || customPoint.direction } : null
      }
    });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- HKO Wind Stations (30 stations from HKO CSV) -----
const HKO_WIND_STATIONS = [
  { name: 'Central Pier', code: 'CP1', lat: 22.2889, lon: 114.1558 },
  { name: 'Chek Lap Kok', code: 'CLK', lat: 22.3094, lon: 113.9219 },
  { name: 'Cheung Chau', code: 'CCH', lat: 22.2011, lon: 114.0267 },
  { name: 'Cheung Chau Beach', code: 'CCB', lat: 22.2108, lon: 114.0292 },
  { name: 'Green Island', code: 'GI', lat: 22.2850, lon: 114.1128 },
  { name: 'Hong Kong Sea School', code: 'HKS', lat: 22.2478, lon: 114.1736 },
  { name: 'Kai Tak', code: 'SE', lat: 22.3097, lon: 114.2133 },
  { name: "King's Park", code: 'KP', lat: 22.3119, lon: 114.1728 },
  { name: 'Lamma Island', code: 'LAM', lat: 22.2261, lon: 114.1086 },
  { name: 'Lau Fau Shan', code: 'LFS', lat: 22.4689, lon: 113.9836 },
  { name: 'Ngong Ping', code: 'NGP', lat: 22.2586, lon: 113.9128 },
  { name: 'North Point', code: 'NP', lat: 22.2944, lon: 114.1997 },
  { name: 'Peng Chau', code: 'PEN', lat: 22.2911, lon: 114.0433 },
  { name: 'Sai Kung', code: 'SKG', lat: 22.3756, lon: 114.2744 },
  { name: 'Sha Chau', code: 'SC', lat: 22.3458, lon: 113.8911 },
  { name: 'Sha Tin', code: 'SHA', lat: 22.4025, lon: 114.2100 },
  { name: 'Shek Kong', code: 'SEK', lat: 22.4361, lon: 114.0847 },
  { name: 'Stanley', code: 'STY', lat: 22.2142, lon: 114.2186 },
  { name: 'Star Ferry', code: 'SF', lat: 22.2931, lon: 114.1686 },
  { name: 'Ta Kwu Ling', code: 'TKL', lat: 22.5286, lon: 114.1567 },
  { name: 'Tai Mei Tuk', code: 'PLC', lat: 22.4753, lon: 114.2375 },
  { name: 'Tai Po Kau', code: 'TPK', lat: 22.4425, lon: 114.1839 },
  { name: 'Tap Mun', code: 'TAP', lat: 22.4714, lon: 114.3606 },
  { name: "Tate's Cairn", code: 'TC', lat: 22.3578, lon: 114.2178 },
  { name: 'Tseung Kwan O', code: 'JKB', lat: 22.3158, lon: 114.2556 },
  { name: 'Tsing Yi', code: 'TY1', lat: 22.3442, lon: 114.1100 },
  { name: 'Tuen Mun', code: 'TU1', lat: 22.3906, lon: 113.9767 },
  { name: 'Waglan Island', code: 'WGL', lat: 22.1822, lon: 114.3033 },
  { name: 'Wetland Park', code: 'WLP', lat: 22.4667, lon: 114.0089 },
  { name: 'Wong Chuk Hang', code: 'WCH', lat: 22.2478, lon: 114.1736 }
];

function findNearestHkoWind(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const stn of HKO_WIND_STATIONS) {
    const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = { ...stn, distance_km: Math.round(d * 111 * 100) / 100 };
    }
  }
  return best;
}

// ----- API: HKO real-time wind (proxy for CSV without CORS) -----
app.get('/api/hko-wind', async function(req, res) {
  try {
    const lat = parseFloat(req.query.lat) || null;
    const lon = parseFloat(req.query.lon) || null;

    const csvUrl = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv';
    const resp = await fetch(csvUrl, { headers: { 'User-Agent': HYDRO_UA } });
    if (!resp.ok) throw new Error('HKO wind CSV returned ' + resp.status);
    const csvText = await resp.text();

    // Parse CSV
    const lines = csvText.trim().split('\n');
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 5) {
        records.push({
          datetime: parts[0].trim(),
          station: parts[1].trim(),
          wind_dir: parts[2].trim(),
          wind_speed: parts[3].trim(),
          wind_gust: parts[4].trim()
        });
      }
    }

    // Find 3 nearest stations with data
    let nearest = [];
    if (lat != null && lon != null) {
      // Build a list of all stations with their distance
      const stationsWithDist = [];
      for (const stn of HKO_WIND_STATIONS) {
        const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
        stationsWithDist.push({
          ...stn,
          distance_km: Math.round(d * 111 * 100) / 100
        });
      }
      stationsWithDist.sort((a, b) => a.distance_km - b.distance_km);

      // Match each with CSV record
      for (const stn of stationsWithDist) {
        const rec = records.find(r => r.station === stn.name);
        if (rec) {
          nearest.push({
            ...rec,
            station_lat: stn.lat,
            station_lon: stn.lon,
            distance_km: stn.distance_km
          });
        }
        if (nearest.length >= 5) break;
      }
    }

    res.json({
      timestamp: records.length > 0 ? records[0].datetime : null,
      records: records,
      nearest: nearest,
      station_count: records.length
    });
  } catch (err) {
    console.error('HKO wind error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- API: Weather (GFS + ECMWF wind) -----
app.get('/api/weather', async function(req, res) {
  try {
    const lat = parseFloat(req.query.lat) || 22.38;
    const lon = parseFloat(req.query.lon) || 113.90;
    const date = req.query.date || null;
    const time = req.query.time || null;
    const data = await fetchWeather(lat, lon, date, time);
    res.json(data);
  } catch (err) {
    console.error('Weather error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- API: Current series (24h hydro CSV) -----
app.get('/api/current-series', async function(req, res) {
  try {
    const reqDate = req.query.date || (new Date().toISOString().split('T')[0]);
    const reqMode = req.query.mode || 'S';
    const reqLat = req.query.lat ? parseFloat(req.query.lat) : null;
    const reqLon = req.query.lon ? parseFloat(req.query.lon) : null;
    const reqPoint = req.query.point || null;

    // Need at least one way to identify the point
    if (!reqPoint && (!reqLat || !reqLon)) {
      return res.status(400).json({ error: 'point or lat+lon required' });
    }

    let pointId = reqPoint;

    // If we have lat/lon but no point_id, find nearest from GeoJSON
    if (!pointId && reqLat && reqLon) {
      const now = new Date();
      const time = reqDate.replace(/-/g, '') + '120000';
      const geojson = await fetchHydroCurrents(time, reqMode);
      const nearest = findNearest(geojson, reqLat, reqLon);
      if (!nearest) throw new Error('No nearby point found');
      pointId = nearest.point_id;
    }

    // Fetch CSV for this point at midnight of the requested date
    const csvTime = reqDate.replace(/-/g, '') + '000000';
    const url = 'https://current.hydro.gov.hk/data/tidal_dygraph_csv.php?time=' + csvTime + '&mode=' + reqMode + '&point=' + pointId;

    let csvText = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(url, { headers: HYDRO_HEADERS });
        csvText = await resp.text();
        if (csvText && csvText.length > 0) break;
      } catch (e) {
        console.log('CSV fetch attempt ' + (attempt + 1) + ' failed: ' + e.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!csvText) throw new Error('Failed to fetch CSV');

    // Parse CSV: timestamp, speed, direction
    const lines = csvText.trim().split('\n');
    const series = [];
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 3) {
        const ts = parts[0].trim();
        const speed = parseFloat(parts[1]);
        const dir = parseFloat(parts[2]);
        if (!isNaN(speed)) {
          series.push({
            time: ts,
            speed: Math.round(speed * 100) / 100,
            direction: isNaN(dir) ? null : Math.round(dir)
          });
        }
      }
    }

    res.json({
      point_id: pointId,
      mode: reqMode === 'S' ? 'Surface (水面)' : 'Average (平均)',
      date: reqDate,
      series: series
    });

  } catch (err) {
    console.error('Series error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- API: Nearby points -----
app.get('/api/nearby', async function(req, res) {
  try {
    const lat = parseFloat(req.query.lat) || 22.39;
    const lon = parseFloat(req.query.lon) || 113.918;
    const limit = parseInt(req.query.limit) || 10;
    const now = new Date();
    const time = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '00';

    const geojson = await fetchHydroCurrents(time, 'S');
    const results = [];
    for (const f of geojson.features) {
      const coords = f.geometry.coordinates;
      const d = Math.sqrt((coords[1] - lat) ** 2 + (coords[0] - lon) ** 2);
      results.push({
        point_id: f.properties.point_id,
        lat: Math.round(coords[1] * 10000) / 10000,
        lon: Math.round(coords[0] * 10000) / 10000,
        speed: parseFloat(f.properties.knot),
        direction: parseFloat(f.properties.deg),
        distance_km: Math.round(d * 111 * 100) / 100
      });
    }
    results.sort((a, b) => a.distance_km - b.distance_km);
    res.json(results.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global error handler — catch uncaught errors so the server doesn't die
process.on('uncaughtException', function(err) {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
});
process.on('unhandledRejection', function(err) {
  console.error('UNHANDLED REJECTION:', err.message, err.stack);
});

// Error middleware for Express
app.use(function(err, req, res, next) {
  console.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('Tide app running on http://localhost:' + PORT);
  console.log('   API: http://localhost:' + PORT + '/api/current');
});