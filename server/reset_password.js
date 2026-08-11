const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'tideapp.db'));

async function main() {
  const hash = await bcrypt.hash('9288', 10);
  db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hash, 'rex.chma@gmail.com');
  console.log('Password updated for rex.chma@gmail.com');
  
  // Verify
  const user = db.prepare('SELECT email, password FROM users WHERE email = ?').get('rex.chma@gmail.com');
  const match = await bcrypt.compare('9288', user.password);
  console.log('Verify login:', match ? 'OK ✅' : 'FAIL ❌');
}

main().catch(console.error);