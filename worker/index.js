// Tide App Worker — Combined static + API + D1
// Serves public/ as static assets, handles API routes with D1
// Routes split into: auth.js, wind.js, tide.js

import { CORS_HEADERS, json, error } from './auth.js';
import { handleRegister, handleLogin, handleDeleteAccount, handlePointsGet, handlePointsPost, handlePointsDelete, handlePointsSync } from './auth.js';
import { handleHkoWind, handleWindHistory, handleWeather, handleWarnings, handleDebugCollectWind, handleForecast, collectHkoWind } from './wind.js';
import { handleCurrent, handleCurrentSeries, handleNearby } from './tide.js';

export default {
  // ---- Cron: collect HKO wind data every 10 min ----
  async scheduled(event, env, ctx) {
    await collectHkoWind(env);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ---- Auth routes ----
      if (path === '/api/register' && request.method === 'POST') {
        return handleRegister(request, env);
      }

      if (path === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // ---- Account deletion ----
      if (path === '/api/account' && request.method === 'DELETE') {
        return handleDeleteAccount(request, env);
      }

      // ---- Points routes ----
      if (path === '/api/points' && request.method === 'GET') {
        return handlePointsGet(request, env);
      }

      if (path === '/api/points' && request.method === 'POST') {
        return handlePointsPost(request, env);
      }

      if (path.startsWith('/api/points/') && request.method === 'DELETE') {
        return handlePointsDelete(request, env);
      }

      if (path === '/api/points/sync' && request.method === 'POST') {
        return handlePointsSync(request, env);
      }

      // ---- API: Current data ----
      if (path === '/api/current') {
        return handleCurrent(request, env);
      }

      // ---- API: Weather ----
      if (path === '/api/weather') {
        return handleWeather(request, env);
      }

      // ---- API: Current series (24h CSV) ----
      if (path === '/api/current-series') {
        return handleCurrentSeries(request, env);
      }

      // ---- API: HKO wind history (collected via cron) ----
      if (path === '/api/wind-history') {
        return handleWindHistory(request, env);
      }

      // ---- Debug: manual collect trigger (requires COLLECT_KEY) ----
      if (path === '/api/debug-collect-wind') {
        return handleDebugCollectWind(request, env);
      }

      // ---- API: HKO real-time wind ----
      if (path === '/api/hko-wind') {
        return handleHkoWind(request, env);
      }

      // ---- API: Multi-model forecast (Open-Meteo proxy) ----
      if (path === '/api/forecast') {
        return handleForecast(request, env);
      }

      // ---- API: HKO warning signals ----
      if (path === '/api/warnings') {
        return handleWarnings(request, env);
      }

      // ---- API: Nearby points ----
      if (path === '/api/nearby') {
        return handleNearby(request, env);
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