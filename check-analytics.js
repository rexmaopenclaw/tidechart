// Query Cloudflare Workers analytics for tidechart (last 7 days)
// Uses OAuth token from wrangler config — token never printed
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgPath = path.join(os.homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml');
const raw = fs.readFileSync(cfgPath, 'utf8');
const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!m) { console.error('No oauth_token found'); process.exit(1); }
const token = m[1];

const ACCOUNT = '7661f2f0292af340f4fb942a30a1a553';
const query = `{
  viewer {
    accounts(filter: {accountTag: "${ACCOUNT}"}) {
      workersInvocationsAdaptive(limit: 7, filter: {date_geq: "2026-08-07", scriptName: "tidechart"}) {
        date: dimensions { date }
        requests: sum { requests }
        errors: sum { errors }
      }
    }
  }
}`;

fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(j => {
  if (j.errors) { console.error('API errors:', JSON.stringify(j.errors, null, 2)); process.exit(1); }
  const rows = (j.data.viewer.accounts[0] || {}).workersInvocationsAdaptive || [];
  rows.sort((a, b) => String(a.date && a.date.date || a.date).localeCompare(String(b.date && b.date.date || b.date)));
  let total = 0;
  for (const r of rows) {
    const reqs = (r.requests && r.requests.requests) || r.requests || 0;
    const errs = (r.errors && r.errors.errors) || r.errors || 0;
    total += reqs;
    const d = String(r.date && r.date.date || r.date);
    console.log(d, '  requests:', reqs, '  errors:', errs);
  }
  console.log('---');
  console.log('Total requests:', total);
}).catch(e => { console.error('Fetch failed:', e.message); process.exit(1); });
