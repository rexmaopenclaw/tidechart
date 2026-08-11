// Tide App Worker — Combined static + API + D1
// Serves public/ as static assets, handles API routes with D1

import { SignJWT, jwtVerify } from 'jose';

// ----- Constants -----
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

// ----- HKO Tide Stations -----
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

// ----- HKO Wind Stations -----
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

// ===== HELPERS =====

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function error(msg, status = 500) {
  return json({ error: msg }, status);
}

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getJwtSecret(env) {
  return new TextEncoder().encode(env.JWT_SECRET || 'tide-app-secret-2026');
}

async function createToken(userId, email, secret) {
  return await new SignJWT({ id: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret);
}

async function verifyAuth(request, db, secret) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const token = header.split(' ')[1];
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

// ===== HYDRO HELPER =====
async function fetchHydroCurrents(time, mode) {
  const url = 'https://current.hydro.gov.hk/data/static_geojson.php?time=' + time + '&mode=' + mode;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://current.hydro.gov.hk/main/prediction_static.php?lang=en'
    }
  });
  const text = await resp.text();
  if (!text) throw new Error('Hydro.gov.hk returned empty response');
  return JSON.parse(text);
}

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

async function findNearestValidHKO(lat, lon) {
  const stations = [];
  for (const [code, stn] of Object.entries(HKO_STATIONS)) {
    const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
    stations.push({ code, name: stn.name, lat: stn.lat, lon: stn.lon, distance_km: Math.round(d * 111 * 100) / 100 });
  }
  stations.sort((a, b) => a.distance_km - b.distance_km);

  let lastError = null;
  for (const stn of stations) {
    try {
      const data = await fetchTideDataStation(new Date().getFullYear(), stn.code);
      return { station: stn, tideRaw: data };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(lastError || 'No valid HKO tide station found');
}

async function fetchTideDataStation(year, stationCode) {
  const url = 'https://www.hko.gov.hk/tide/' + stationCode + 'textPH' + year + '.htm';
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

async function fetchOpenMeteoTide(lat, lon) {
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
  const jsonResp = await resp.json();
  if (!jsonResp.hourly || !jsonResp.hourly.time || !jsonResp.hourly.sea_level_height_msl) {
    throw new Error('Open-Meteo no tide data for ' + lat + ',' + lon);
  }

  const data = {};
  const times = jsonResp.hourly.time;
  const heights = jsonResp.hourly.sea_level_height_msl;
  let currentKey = null;
  let currentVals = [];
  for (let i = 0; i < times.length; i++) {
    const key = times[i].substring(5, 7) + times[i].substring(8, 10);
    if (currentKey !== key) {
      if (currentKey && currentVals.length === 24) data[currentKey] = currentVals;
      currentKey = key;
      currentVals = [];
    }
    currentVals.push(heights[i]);
  }
  if (currentKey && currentVals.length === 24) data[currentKey] = currentVals;
  if (Object.keys(data).length === 0) throw new Error('No tide days parsed');
  return data;
}

async function fetchWeather(lat, lon, dateStr, timeStr) {
  const reqDate = dateStr || new Date().toISOString().split('T')[0];
  const base = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&start_date=' + reqDate + '&end_date=' + reqDate +
    '&timezone=Asia/Hong_Kong&wind_speed_unit=kn';

  const [gfsResp, ecmwfResp] = await Promise.all([
    fetch(base + '&models=gfs_seamless'),
    fetch(base + '&models=ecmwf_ifs')
  ]);

  let gfs, ecmwf;
  if (gfsResp.ok) gfs = await gfsResp.json();
  else gfs = {};
  if (ecmwfResp.ok) ecmwf = await ecmwfResp.json();
  else ecmwf = {};

  const pick = (j, modelName) => {
    if (j.error) return null;
    const times = j.hourly && j.hourly.time || [];
    const speeds = j.hourly && j.hourly.wind_speed_10m || [];
    const gusts = j.hourly && j.hourly.wind_gusts_10m || [];
    const dirs = j.hourly && j.hourly.wind_direction_10m || [];
    if (times.length === 0) return null;

    let idx = -1;
    if (timeStr && times.length > 0) {
      const targetHour = parseInt(timeStr.substring(0, 2), 10);
      const targetMin = parseInt(timeStr.substring(2, 4), 10);
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const h = parseInt(t.substring(11, 13), 10);
        const m = parseInt(t.substring(14, 16), 10);
        if (h === targetHour && m === targetMin) { idx = i; break; }
        if (h === targetHour && m <= targetMin) idx = i;
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

  return { gfs: pick(gfs), ecmwf: pick(ecmwf) };
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

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return '$pbkdf2$' + saltHex + '$' + hashHex;
}

async function verifyPassword(password, hash) {
  const parts = hash.split('$');
  if (parts[0] !== '' || parts[1] !== 'pbkdf2') return false;
  const saltHex = parts[2];
  const storedHash = parts[3];
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === storedHash;
}

// ===== ROUTE HANDLER =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;
    const jwtSecret = getJwtSecret(env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ---- Auth routes ----
      if (path === '/api/register' && request.method === 'POST') {
        const body = await getBody(request);
        if (!body || !body.email || !body.password) return error('Email and password required', 400);
        if (body.password.length < 4) return error('Password too short', 400);

        const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
        if (existing) return error('Email already registered', 400);

        const hash = await hashPassword(body.password);
        const result = await db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').bind(body.email, hash).run();
        const userId = result.meta.last_row_id;
        const token = await createToken(userId, body.email, jwtSecret);
        return json({ token, user: { id: userId, email: body.email } });
      }

      if (path === '/api/login' && request.method === 'POST') {
        const body = await getBody(request);
        if (!body || !body.email || !body.password) return error('Email and password required', 400);

        const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(body.email).first();
        if (!user) return error('Invalid email or password', 400);

        const match = await verifyPassword(body.password, user.password);
        if (!match) return error('Invalid email or password', 400);

        const token = await createToken(user.id, user.email, jwtSecret);
        return json({ token, user: { id: user.id, email: user.email } });
      }

      // ---- Points routes (auth required) ----
      const auth = await verifyAuth(request, db, jwtSecret);

      if (path === '/api/points' && request.method === 'GET') {
        if (!auth) return error('Unauthorized', 401);
        const points = await db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY created_at').bind(auth.id).all();
        return json(points.results);
      }

      if (path === '/api/points' && request.method === 'POST') {
        if (!auth) return error('Unauthorized', 401);
        const body = await getBody(request);
        if (!body || !body.name || body.lat == null || body.lon == null) return error('name, lat, lon required', 400);
        const result = await db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)').bind(auth.id, body.name, body.lat, body.lon).run();
        return json({ id: result.meta.last_row_id, name: body.name, lat: body.lat, lon: body.lon });
      }

      if (path.startsWith('/api/points/') && request.method === 'DELETE') {
        if (!auth) return error('Unauthorized', 401);
        const id = path.split('/').pop();
        const result = await db.prepare('DELETE FROM points WHERE id = ? AND user_id = ?').bind(id, auth.id).run();
        if (result.meta.changes === 0) return error('Point not found', 404);
        return json({ ok: true });
      }

      if (path === '/api/points/sync' && request.method === 'POST') {
        if (!auth) return error('Unauthorized', 401);
        const body = await getBody(request);
        if (!body || !Array.isArray(body.points)) return error('points array required', 400);

        await db.prepare('DELETE FROM points WHERE user_id = ?').bind(auth.id).run();
        for (const p of body.points) {
          await db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)').bind(auth.id, p.name, p.lat, p.lon).run();
        }
        const points = await db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY id').bind(auth.id).all();
        return json(points.results);
      }

      // ---- API: Current data ----
      if (path === '/api/current') {
        const now = new Date();
        const year = now.getFullYear();

        const reqDate = url.searchParams.get('date') || (year + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'));
        const rawTime = url.searchParams.get('time') || (String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '00');
        const reqTime = roundTime(rawTime);
        const reqMode = url.searchParams.get('mode') || 'S';
        const reqPoint = url.searchParams.get('point') || null;
        const reqLat = url.searchParams.get('lat') ? parseFloat(url.searchParams.get('lat')) : null;
        const reqLon = url.searchParams.get('lon') ? parseFloat(url.searchParams.get('lon')) : null;

        const hydroTime = reqDate.replace(/-/g, '') + reqTime;
        const lat2 = reqLat || 22.38;
        const lon2 = reqLon || 113.90;

        let tideRaw, tideStation;
        try {
          tideRaw = await fetchOpenMeteoTide(lat2, lon2);
          tideStation = { code: 'OPENMETEO', name: 'Open-Meteo (模型)', lat: lat2, lon: lon2, distance_km: 0 };
        } catch (e) {
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

        return json({
          time: hydroTime,
          mode: reqMode === 'S' ? 'Surface (水面)' : 'Average (平均)',
          tide,
          current: {
            channel: channelPoint ? { ...channelPoint, compass: degToCompass(channelPoint.direction), compass_cn: DIR_NAMES[degToCompass(channelPoint.direction)] || channelPoint.direction } : null,
            windsurf: windsurfPoint ? { ...windsurfPoint, compass: degToCompass(windsurfPoint.direction), compass_cn: DIR_NAMES[degToCompass(windsurfPoint.direction)] || windsurfPoint.direction } : null,
            specific: specificPoint ? { ...specificPoint, compass: degToCompass(specificPoint.direction), compass_cn: DIR_NAMES[degToCompass(specificPoint.direction)] || specificPoint.direction } : null,
            custom: customPoint ? { ...customPoint, compass: degToCompass(customPoint.direction), compass_cn: DIR_NAMES[degToCompass(customPoint.direction)] || customPoint.direction } : null
          }
        });
      }

      // ---- API: Weather ----
      if (path === '/api/weather') {
        const lat = parseFloat(url.searchParams.get('lat')) || 22.38;
        const lon = parseFloat(url.searchParams.get('lon')) || 113.90;
        const date = url.searchParams.get('date') || null;
        const time = url.searchParams.get('time') || null;
        const data = await fetchWeather(lat, lon, date, time);
        return json(data);
      }

      // ---- API: Current series (24h CSV) ----
      if (path === '/api/current-series') {
        const reqDate = url.searchParams.get('date') || (new Date().toISOString().split('T')[0]);
        const reqMode = url.searchParams.get('mode') || 'S';
        const reqLat = url.searchParams.get('lat') ? parseFloat(url.searchParams.get('lat')) : null;
        const reqLon = url.searchParams.get('lon') ? parseFloat(url.searchParams.get('lon')) : null;
        const reqPoint = url.searchParams.get('point') || null;

        let pointId = reqPoint;
        if (!pointId && reqLat && reqLon) {
          const now = new Date();
          const time = reqDate.replace(/-/g, '') + '120000';
          const geojson = await fetchHydroCurrents(time, reqMode);
          const nearest = findNearest(geojson, reqLat, reqLon);
          if (!nearest) return error('No nearby point found', 404);
          pointId = nearest.point_id;
        }

        if (!pointId) return error('point or lat/lon required', 400);

        const csvTime = reqDate.replace(/-/g, '') + '000000';
        const urlCsv = 'https://current.hydro.gov.hk/data/tidal_dygraph_csv.php?time=' + csvTime + '&mode=' + reqMode + '&point=' + pointId;

        let csvText = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const resp = await fetch(urlCsv, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://current.hydro.gov.hk/main/prediction_static.php?lang=en'
              }
            });
            csvText = await resp.text();
            if (csvText && csvText.length > 0) break;
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }

        if (!csvText) return error('Failed to fetch CSV', 502);

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

        return json({
          point_id: pointId,
          mode: reqMode === 'S' ? 'Surface (水面)' : 'Average (平均)',
          date: reqDate,
          series
        });
      }

      // ---- API: HKO real-time wind ----
      if (path === '/api/hko-wind') {
        const lat = parseFloat(url.searchParams.get('lat')) || null;
        const lon = parseFloat(url.searchParams.get('lon')) || null;

        const csvUrl = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv';
        const resp = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!resp.ok) return error('HKO wind CSV returned ' + resp.status, 502);
        const csvText = await resp.text();

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

        let nearest = [];
        if (lat != null && lon != null) {
          const stationsWithDist = [];
          for (const stn of HKO_WIND_STATIONS) {
            const d = Math.sqrt((stn.lat - lat) ** 2 + (stn.lon - lon) ** 2);
            stationsWithDist.push({ ...stn, distance_km: Math.round(d * 111 * 100) / 100 });
          }
          stationsWithDist.sort((a, b) => a.distance_km - b.distance_km);

          for (const stn of stationsWithDist) {
            const rec = records.find(r => r.station === stn.name);
            if (rec) {
              nearest.push({ ...rec, station_lat: stn.lat, station_lon: stn.lon, distance_km: stn.distance_km });
            }
            if (nearest.length >= 5) break;
          }
        }

        return json({
          timestamp: records[0] ? records[0].datetime : null,
          total_stations: records.length,
          nearest
        });
      }

      // ---- API: Nearby points ----
      if (path === '/api/nearby') {
        const lat = parseFloat(url.searchParams.get('lat')) || 22.39;
        const lon = parseFloat(url.searchParams.get('lon')) || 113.918;
        const limit = parseInt(url.searchParams.get('limit')) || 10;
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
        return json(results.slice(0, limit));
      }

      // ---- Fallback: 404 for unknown API routes ----
      if (path.startsWith('/api/')) {
        return error('Not found', 404);
      }

      // ---- Non-API routes: serve static assets from public/ ----
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status === 404) return assetResp;
      const ct = assetResp.headers.get('Content-Type') || '';
      if (ct && !ct.includes('charset')) {
        const textTypes = ['text/html', 'text/css', 'text/javascript', 'application/javascript', 'application/json'];
        if (textTypes.some(t => ct.startsWith(t))) {
          const newHeaders = new Headers(assetResp.headers);
          newHeaders.set('Content-Type', ct + '; charset=utf-8');
          return new Response(assetResp.body, {
            status: assetResp.status,
            statusText: assetResp.statusText,
            headers: newHeaders
          });
        }
      }
      return assetResp;

    } catch (err) {
      console.error('Error:', err.message, err.stack);
      return error(err.message, 500);
    }
  }
};