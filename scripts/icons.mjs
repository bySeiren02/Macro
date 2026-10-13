// 의존성 없이 PNG 아이콘을 생성한다 (zlib + 직접 구현한 CRC32).
// 파란 둥근 사각형 위에 흰색 티켓 모양 + 절취선.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const BLUE = [31, 111, 235, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** 단위 좌표(0..1)에서의 색상 */
function colorAt(x, y) {
  if (!insideRoundedRect(x, y, 0, 0, 1, 1, 0.22)) return CLEAR;
  const inTicket = insideRoundedRect(x, y, 0.16, 0.3, 0.84, 0.7, 0.05);
  const notch = (x - 0.16) ** 2 + (y - 0.5) ** 2 < 0.085 ** 2 || (x - 0.84) ** 2 + (y - 0.5) ** 2 < 0.085 ** 2;
  const perforation = x > 0.6 && x < 0.635 && Math.floor((y - 0.3) / 0.06) % 2 === 0;
  return inTicket && !notch && !perforation ? WHITE : BLUE;
}

function renderPng(size) {
  const SS = 4; // 4x4 슈퍼샘플링 안티앨리어싱
  const rows = [];
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(1 + size * 4); // 필터 바이트 0
    for (let px = 0; px < size; px += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          const a = c[3] / 255;
          acc[0] += c[0] * a;
          acc[1] += c[1] * a;
          acc[2] += c[2] * a;
          acc[3] += c[3];
        }
      }
      const n = SS * SS;
      const alpha = acc[3] / n;
      const premul = alpha > 0 ? 255 / alpha : 0;
      const offset = 1 + px * 4;
      row[offset] = Math.round((acc[0] / n) * premul);
      row[offset + 1] = Math.round((acc[1] / n) * premul);
      row[offset + 2] = Math.round((acc[2] / n) * premul);
      row[offset + 3] = Math.round(alpha);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function writeIcons(outDir, sizes = [16, 32, 48, 128]) {
  await mkdir(outDir, { recursive: true });
  await Promise.all(sizes.map((s) => writeFile(path.join(outDir, `icon-${s}.png`), renderPng(s))));
}
