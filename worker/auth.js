// Tide App Worker — Auth module: helpers, constants, auth routes, points routes

import { SignJWT, jwtVerify } from 'jose';

// ----- Constants -----
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const DIR_NAMES = {
  'N': '北', 'NNE': '北北東', 'NE': '東北', 'ENE': '東北東',
  'E': '東', 'ESE': '東南東', 'SE': '東南', 'SSE': '南南東',
  'S': '南', 'SSW': '南南西', 'SW': '西南', 'WSW': '西南西',
  'W': '西', 'WNW': '西北西', 'NW': '西北', 'NNW': '北北西'
};

// HKO warning statement codes -> Chinese names
export const WARNING_NAMES = {
  'WTC': '熱帶氣旋警告信號',
  'WRAIN': '暴雨警告信號',
  'WTS': '雷暴警告',
  'WFROST': '霜凍警告',
  'WFLOOD': '山泥傾瀉警告',
  'WFIRE': '火災危險警告',
  'WHCO': '寒冷天氣警告',
  'WHOT': '酷熱天氣警告',
  'WFO': '水浸特別報告',
  'WMS': '強烈季候風信號',
  'WSPEC': '特別天氣提示'
};

// HKO rainstorm subtypes (WRAIN only)
export const WARNING_SUBTYPES = {
  'WRAINA': '黃色暴雨警告信號',
  'WRAINR': '紅色暴雨警告信號',
  'WRAINB': '黑色暴雨警告信號'
};

export function degToCompass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ===== HELPERS =====

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function error(msg, status = 500) {
  return json({ error: msg }, status);
}

export async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function getJwtSecret(env) {
  return new TextEncoder().encode(env.JWT_SECRET || 'tide-app-secret-2026');
}

export async function createToken(userId, email, secret) {
  return await new SignJWT({ id: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyAuth(request, db, secret) {
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

export async function hashPassword(password) {
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

export async function verifyPassword(password, hash) {
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

// ===== AUTH ROUTE HANDLERS =====

export async function handleRegister(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const body = await getBody(request);
  if (!body || !body.email || !body.password) return error('Email and password required', 400);
  if (body.password.length < 4) return error('Password too short', 400);

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
  if (existing) return error('Email already registered', 400);

  const hash = await hashPassword(body.password);
  const result = await db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').bind(body.email, hash).run();
  const userId = result.meta.last_row_id;
  // Seed default points for new user
  const DEFAULT_POINTS = [
    { name: '龍鼓下水點', lat: 22.39, lon: 113.9183 },
    { name: '龍鼓水道', lat: 22.3804, lon: 113.9014 },
    { name: '大門', lat: 22.1989, lon: 114.2453 }
  ];
  for (const p of DEFAULT_POINTS) {
    await db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)').bind(userId, p.name, p.lat, p.lon).run();
  }
  const token = await createToken(userId, body.email, jwtSecret);
  return json({ token, user: { id: userId, email: body.email } });
}

export async function handleLogin(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const body = await getBody(request);
  if (!body || !body.email || !body.password) return error('Email and password required', 400);

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(body.email).first();
  if (!user) return error('Invalid email or password', 400);

  const match = await verifyPassword(body.password, user.password);
  if (!match) return error('Invalid email or password', 400);

  const token = await createToken(user.id, user.email, jwtSecret);
  return json({ token, user: { id: user.id, email: user.email } });
}

export async function handleDeleteAccount(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const auth = await verifyAuth(request, db, jwtSecret);
  if (!auth) return error('Unauthorized', 401);
  await db.prepare('DELETE FROM points WHERE user_id = ?').bind(auth.id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(auth.id).run();
  return json({ ok: true });
}

// ===== POINTS ROUTE HANDLERS =====

export async function handlePointsGet(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const auth = await verifyAuth(request, db, jwtSecret);
  if (!auth) return error('Unauthorized', 401);
  const points = await db.prepare('SELECT id, name, lat, lon FROM points WHERE user_id = ? ORDER BY id').bind(auth.id).all();
  return json(points.results);
}

export async function handlePointsPost(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const auth = await verifyAuth(request, db, jwtSecret);
  if (!auth) return error('Unauthorized', 401);
  const body = await getBody(request);
  if (!body || !body.name || body.lat == null || body.lon == null) return error('name, lat, lon required', 400);
  const result = await db.prepare('INSERT INTO points (user_id, name, lat, lon) VALUES (?, ?, ?, ?)').bind(auth.id, body.name, body.lat, body.lon).run();
  return json({ id: result.meta.last_row_id, name: body.name, lat: body.lat, lon: body.lon });
}

export async function handlePointsDelete(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const auth = await verifyAuth(request, db, jwtSecret);
  if (!auth) return error('Unauthorized', 401);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  const result = await db.prepare('DELETE FROM points WHERE id = ? AND user_id = ?').bind(id, auth.id).run();
  if (result.meta.changes === 0) return error('Point not found', 404);
  return json({ ok: true });
}

export async function handlePointsSync(request, env) {
  const db = env.DB;
  const jwtSecret = getJwtSecret(env);
  const auth = await verifyAuth(request, db, jwtSecret);
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