// Tide App Worker — Tide module: HKO tide stations, tide data fetching, current data, nearby points

import { CORS_HEADERS, DIR_NAMES, degToCompass, json, error } from './auth.js';

// ----- HKO Tide Stations -----
export const HKO_STATIONS = {
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

// ===== HYDRO HELPER =====

export async function fetchHydroCurrents(time, mode) {
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

export function findNearest(geojson, lat, lon) {
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

export function processTideData(rawData, targetDate) {
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const dateKey = month + day;
  const todayData = rawData[dateKey];
  if (!todayData) return { error: 'No tide data for ' + dateKey };

  // Parabolic interpolation: estimate true peak time (minutes) from 3 hourly points
  // Given (x0,y0)=(h-1,y0), (x1,y1)=(h,y1), (x2,y2)=(h+1,y2)
  // parabola vertex x* = h + (y0 - y2) / (2*(y0 - 2*y1 + y2)), y* = y1 - (y0-y2)^2/(8*(y0-2*y1+y2))
  function fitPeak(h) {
    const y0 = todayData[h - 1], y1 = todayData[h], y2 = todayData[h + 1];
    if (y0 == null || y1 == null || y2 == null) return null;
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) < 1e-6) return null;
    const offset = (y0 - y2) / (2 * denom);
    const peakHour = h + offset;
    const peakVal = y1 - ((y0 - y2) * (y0 - y2)) / (8 * denom);
    if (peakHour < h - 0.9 || peakHour > h + 0.9) return null;
    return { hour: peakHour, height: Math.round(peakVal * 100) / 100 };
  }

  const fmtTime = (hourFloat) => {
    const hh = Math.floor(hourFloat);
    const mm = Math.round((hourFloat - hh) * 60);
    if (mm === 60) return String(hh + 1).padStart(2, '0') + ':00';
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  const highs = [], lows = [];
  for (let h = 1; h < 23; h++) {
    if (todayData[h] > todayData[h - 1] && todayData[h] > todayData[h + 1]) {
      const p = fitPeak(h);
      if (p) highs.push({ hour: p.hour, height: p.height });
    }
    if (todayData[h] < todayData[h - 1] && todayData[h] < todayData[h + 1]) {
      const p = fitPeak(h);
      if (p) lows.push({ hour: p.hour, height: p.height });
    }
  }
  // Edge hours: no interpolation, keep raw
  if (todayData[0] > todayData[1]) highs.push({ hour: 0, height: Math.round(todayData[0] * 100) / 100 });
  if (todayData[0] < todayData[1]) lows.push({ hour: 0, height: Math.round(todayData[0] * 100) / 100 });
  if (todayData[23] > todayData[22]) highs.push({ hour: 23, height: Math.round(todayData[23] * 100) / 100 });
  if (todayData[23] < todayData[22]) lows.push({ hour: 23, height: Math.round(todayData[23] * 100) / 100 });

  const minH = Math.min(...todayData);
  const maxH = Math.max(...todayData);

  return {
    date: targetDate.getFullYear() + '-' + month + '-' + day,
    minHeight: Math.round(minH * 100) / 100,
    maxHeight: Math.round(maxH * 100) / 100,
    range: Math.round((maxH - minH) * 100) / 100,
    highs: highs.map(h => ({ hour: Math.round(h.hour * 4) / 4, height: h.height, time: fmtTime(h.hour) })),
    lows: lows.map(h => ({ hour: Math.round(h.hour * 4) / 4, height: h.height, time: fmtTime(h.hour) })),
    hours: todayData.map((h, i) => ({ hour: i, height: Math.round(h * 100) / 100, time: fmtTime(i) }))
  };
}

export async function fetchTideDataStation(year, stationCode) {
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

export async function fetchOpenMeteoTide(lat, lon) {
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

export async function findNearestValidHKO(lat, lon) {
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

export function roundTime(timeStr) {
  const h = timeStr.substring(0, 2);
  const m = parseInt(timeStr.substring(2, 4));
  const rounded = Math.round(m / 15) * 15;
  if (rounded >= 60) {
    const nextH = String(parseInt(h) + 1).padStart(2, '0');
    return nextH + '00' + '00';
  }
  return h + String(rounded).padStart(2, '0') + '00';
}

// ===== ROUTE HANDLERS =====

export async function handleCurrent(request, env) {
  const url = new URL(request.url);
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
  let tide = processTideData(tideRaw, targetDate);
  // Open-Meteo only covers today+6d — if the requested date is missing, fall back to HKO full-year table
  if (tide.error && tideStation.code === 'OPENMETEO') {
    try {
      const { station, tideRaw: hkoRaw } = await findNearestValidHKO(lat2, lon2);
      const hkoTide = processTideData(hkoRaw, targetDate);
      if (!hkoTide.error) {
        tide = hkoTide;
        tide.station = station;
      }
    } catch (e2) { /* keep original error */ }
  }
  tide.station = tide.station || tideStation;

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

export async function handleCurrentSeries(request, env) {
  const url = new URL(request.url);
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

export async function handleNearby(request, env) {
  const url = new URL(request.url);
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