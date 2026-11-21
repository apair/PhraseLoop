import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, { maskable }) {
  const bg = [79, 70, 229], fg = [255, 255, 255];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const safe = maskable ? 0.62 : 0.78;
  const cardW = size * safe * 0.78, cardH = size * safe * 0.56;
  const cx = size / 2, cy = size / 2, r = size * 0.05;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx) - (cardW / 2 - r), dy = Math.abs(y - cy) - (cardH / 2 - r);
      const inside = Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 <= r * r && dx <= r && dy <= r;
      const line = inside && Math.abs(y - cy) < size * 0.012 + 0 && Math.abs(x - cx) < cardW * 0.35;
      const c = line ? bg : inside ? fg : bg;
      const o = row + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync('public/pwa-192.png', png(192, {}));
writeFileSync('public/pwa-512.png', png(512, {}));
writeFileSync('public/pwa-maskable-512.png', png(512, { maskable: true }));
writeFileSync('public/apple-touch-icon.png', png(180, {}));
