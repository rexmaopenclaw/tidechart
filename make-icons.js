// Generate PWA icons (192 / 512) — wave pattern, SeaCast theme
// Run: node make-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function waveIcon(size) {
  const cy = size / 2;
  const amp = size * 0.13;
  return (x, y) => {
    // dark blue gradient background (#0a1628 -> #0f1c30)
    const t = y / size;
    const bgR = Math.round(10 + 5 * t);
    const bgG = Math.round(22 + 6 * t);
    const bgB = Math.round(40 + 8 * t);
    // two sine waves
    const y1 = cy - amp * Math.sin((x / size) * Math.PI * 2);
    const y2 = cy + amp * Math.sin((x / size) * Math.PI * 2 + 0.7) + size * 0.12;
    const d1 = Math.abs(y - y1);
    const d2 = Math.abs(y - y2);
    let r = bgR, g = bgG, b = bgB, a = 255;
    if (d1 < 2.5) { r = 96; g = 176; b = 244; }          // #60b0f4 top wave
    else if (d2 < 2.5) { r = 78; g = 205; b = 196; }     // #4ecdc4 bottom wave
    else if (y > y1 && y < y2) { r = 60; g = 120; b = 190; a = 80; } // translucent fill
    return [r, g, b, a];
  };
}

const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = makePng(size, waveIcon(size));
  const file = path.join(outDir, 'icon-' + size + '.png');
  fs.writeFileSync(file, png);
  console.log('Wrote', file, png.length, 'bytes');
}
