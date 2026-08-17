const { execSync } = require('child_process');
try {
  const out = execSync(
    'npx wrangler d1 execute tide-app-db --remote --json --command "SELECT id, user_id, name, lat, lon FROM points ORDER BY user_id, id"',
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  // wrangler --json 可能輸出多行 JSON array，攞最後一個完整 JSON
  const lines = out.trim().split(/\r?\n/).filter(l => l.trim());
  let parsed = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try { parsed = JSON.parse(lines[i]); break; } catch { /* try prev */ }
  }
  if (!parsed) { console.log('RAW:', out.slice(0, 500)); return; }
  const arr = Array.isArray(parsed) ? parsed : (parsed[0] && parsed[0].results) || [];
  console.log('total rows:', arr.length);
  // 按 name+lat+lon 睇重複
  const seen = {};
  arr.forEach(r => {
    const k = `${r.user_id}|${r.name}|${r.lat}|${r.lon}`;
    if (!seen[k]) seen[k] = [];
    seen[k].push(r.id);
  });
  const dupes = Object.entries(seen).filter(([, ids]) => ids.length > 1);
  console.log('duplicate groups:', dupes.length);
  dupes.slice(0, 20).forEach(([k, ids]) => console.log(' DUP:', k, 'ids:', ids.join(',')));
  console.log('--- all rows ---');
  arr.forEach(r => console.log(`${r.user_id} | ${r.id} | ${r.name} | ${r.lat} | ${r.lon}`));
} catch (e) {
  console.error('ERR', e.message.slice(0, 300));
}
