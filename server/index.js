const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3002;
const JWT_SECRET = 'tide-app-secret-2026';

// ----- DB -----
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

// ----- Middleware -----
app.use(express.static(path.join(__dirname, '../public')));
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
    const token = jwt.sign({ id: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: result.lastInsertRowid, email } });
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
  const points = db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY created_at').all(req.user.id);
  res.json(points);
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
  const result = db.prepare('DELETE FROM points WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Point not found' });
  res.json({ ok: true });
});

app.post('/api/points/sync', authMiddleware, function(req, res) {
  try {
    const { points: clientPoints } = req.body;
    if (!Array.isArray(clientPoints)) return res.status(400).json({ error: 'points array required' });

    // Replace all user points with client state
    const del = db.prepare('DELETE FROM points WHERE user_id = ?');
    const ins = db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction(() => {
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

    // Find nearest HKO tide station
    const nearestHKO = findNearestHKO(reqLat || 22.38, reqLon || 113.90);
    const hkoStationCode = nearestHKO ? nearestHKO.code : 'TBT';

    const tideRaw = await getTideData(hkoStationCode);
    const targetDate = new Date(reqDate + 'T' + reqTime.substring(0, 2) + ':' + reqTime.substring(2, 4) + ':00');
    const tide = processTideData(tideRaw, targetDate);
    tide.station = nearestHKO ? nearestHKO : { code: 'TBT', name: '尖鼻咀 (Tsim Bei Tsui)', lat: 22.483, lon: 114.000, distance_km: 0 };

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