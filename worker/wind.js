// Tide App Worker — Wind module: HKO wind stations, wind collection, weather, warnings

import { CORS_HEADERS, DIR_NAMES, WARNING_NAMES, WARNING_SUBTYPES, degToCompass, json, error } from './auth.js';

// ----- HKO Wind Stations -----
export const HKO_WIND_STATIONS = [
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

// ===== WIND COLLECTION (cron) =====

export async function ensureWindTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS wind_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station TEXT NOT NULL,
    datetime TEXT NOT NULL,
    wind_dir TEXT,
    wind_speed REAL,
    wind_gust REAL,
    UNIQUE(station, datetime)
  )`).run();
}

export async function collectHkoWind(env) {
  try {
    const db = env.DB;
    await ensureWindTable(db);

    const csvUrl = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv?t=' + Date.now();
    const resp = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store'
    });
    if (!resp.ok) {
      console.error('collectHkoWind: CSV returned', resp.status);
      return { ok: false, error: 'CSV status ' + resp.status };
    }
    const csvText = await resp.text();
    const lines = csvText.trim().split('\n');
    const stmt = db.prepare('INSERT OR IGNORE INTO wind_history (station, datetime, wind_dir, wind_speed, wind_gust) VALUES (?, ?, ?, ?, ?)');
    let inserted = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 5) {
        const datetime = parts[0].trim();
        const station = parts[1].trim();
        const wind_dir = parts[2].trim();
        const wind_speed = parseFloat(parts[3].trim());
        const wind_gust = parseFloat(parts[4].trim());
        if (!isNaN(wind_speed)) {
          const r = await stmt.bind(station, datetime, wind_dir, wind_speed, wind_gust).run();
          inserted += r.meta.changes;
        }
      }
    }
    console.log('collectHkoWind: inserted', inserted, 'records');
    return { ok: true, inserted };
  } catch (e) {
    console.error('collectHkoWind error:', e.message);
    return { ok: false, error: e.message };
  }
}

export function windTimeKey(d) {
  // HKO CSV uses Hong Kong time (UTC+8) — convert before extracting
  const hkt = new Date(d.getTime() + 8 * 3600 * 1000);
  return String(hkt.getUTCFullYear()) +
    String(hkt.getUTCMonth() + 1).padStart(2, '0') +
    String(hkt.getUTCDate()).padStart(2, '0') +
    String(hkt.getUTCHours()).padStart(2, '0') +
    String(Math.floor(hkt.getUTCMinutes() / 10) * 10).padStart(2, '0');
}

// ===== WEATHER HELPER =====

export async function fetchWeather(lat, lon, dateStr, timeStr) {
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

// ===== ROUTE HANDLERS =====

export async function handleHkoWind(request, env) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat')) || null;
  const lon = parseFloat(url.searchParams.get('lon')) || null;

  const csvUrl = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv?t=' + Date.now();
  const resp = await fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
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

export async function handleWindHistory(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  await ensureWindTable(db);
  const station = url.searchParams.get('station') || 'Sha Chau';
  const hours = parseInt(url.searchParams.get('hours')) || 24;
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const sinceKey = windTimeKey(since);
  const rows = await db.prepare('SELECT datetime, wind_dir, wind_speed, wind_gust FROM wind_history WHERE station = ? AND datetime >= ? ORDER BY datetime ASC').bind(station, sinceKey).all();
  return json({ station, hours, count: rows.results.length, rows: rows.results });
}

export async function handleWeather(request, env) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat')) || 22.38;
  const lon = parseFloat(url.searchParams.get('lon')) || 113.90;
  const date = url.searchParams.get('date') || null;
  const time = url.searchParams.get('time') || null;
  const data = await fetchWeather(lat, lon, date, time);
  return json(data);
}

export async function handleWarnings(request, env) {
  const urlW = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc&t=' + Date.now();
  const resp = await fetch(urlW, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!resp.ok) return error('HKO warning API returned ' + resp.status, 502);
  const j = await resp.json();
  const warnings = [];
  const list = Array.isArray(j.details) ? j.details : [];
  for (const d of list) {
    const code = d.warningStatementCode || '';
    const subtype = d.subtype || '';
    const first = Array.isArray(d.contents) && d.contents.length > 0 ? d.contents[0] : '';
    // Short name only: exact code -> subtype -> map -> first line before punctuation
    const fallback = (first.split(/[：:。]/)[0] || first).trim();
    warnings.push({
      code: code,
      name: WARNING_SUBTYPES[subtype] || WARNING_NAMES[code] || fallback,
      updateTime: d.updateTime || null,
      contents: Array.isArray(d.contents) ? d.contents : []
    });
  }
  return json({ fetchedAt: new Date().toISOString(), warnings });
}

export async function handleDebugCollectWind(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.COLLECT_KEY || key !== env.COLLECT_KEY) return error('Forbidden', 403);
  const result = await collectHkoWind(env);
  return json(result);
}

// ===== FORECAST PROXY (Open-Meteo multi-model, from Windward) =====

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';

export async function handleForecast(request, env) {
  try {
    const url = new URL(request.url);
    const p = new URLSearchParams(url.search);
    const lat = p.get('latitude');
    const lon = p.get('longitude');
    if (!lat || !lon) {
      return json({ error: 'latitude & longitude required' }, 400);
    }
    const days = p.get('forecast_days') || '7';
    const models = p.get('models') || 'gfs_seamless,ecmwf_ifs025,icon_seamless,meteofrance_seamless';
    // Build query manually — URLSearchParams would encode ',' as '%2C'
    // and Open-Meteo then fails to parse multi-model.
    const q =
      `latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&wind_speed_unit=kn&forecast_days=${days}&models=${models}`;
    const upstream = await fetch(OPEN_METEO_FORECAST + '?' + q, {
      headers: { 'accept': 'application/json' },
    });
    const body = await upstream.json();
    return json(body, upstream.status);
  } catch (err) {
    return json({ error: 'upstream error: ' + err.message }, 502);
  }
}