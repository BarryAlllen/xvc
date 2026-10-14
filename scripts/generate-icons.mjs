import {mkdir, writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const palette = {
  tile: '#191d32', rim: '#414b68', edge: '#0b0e1d',
  x: '#70e5fa', xShade: '#166276',
  v: '#ff86c8', vShade: '#852c65',
  c: '#ffdf82', cShade: '#846022'
};
const letters = [
  {x: 2, color: 'x', rows: ['101', '101', '010', '101', '101']},
  {x: 6, color: 'v', rows: ['101', '101', '101', '101', '010']},
  {x: 10, color: 'c', rows: ['111', '100', '100', '100', '111']}
];
const inside = (x, y) => {
  if (x < 0 || x > 15 || y < 0 || y > 15) return false;
  const cut = [3, 2, 1][Math.min(y, 15 - y)] ?? 0;
  return x >= cut && x < 16 - cut;
};
function artwork() {
  const grid = Array.from({length: 16}, () => Array(16).fill(null));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!inside(x, y)) continue;
    grid[y][x] = !inside(x, y - 1) || !inside(x - 1, y) ? palette.rim
      : !inside(x, y + 1) || !inside(x + 1, y) ? palette.edge : palette.tile;
  }
  // All shapes sit on a 16 px grid; every output is an exact integer enlargement.
  for (const shadow of [true, false]) for (const letter of letters) {
    letter.rows.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel === '1') grid[5 + dy + Number(shadow)][letter.x + dx + Number(shadow)] = palette[letter.color + (shadow ? 'Shade' : '')];
    }));
  }
  return grid;
}
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(grid, size) {
  const scale = size / 16;
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hex = grid[Math.floor(y / scale)][Math.floor(x / scale)];
    if (hex) pixels.set([...Buffer.from(hex.slice(1), 'hex'), 255], y * (size * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export async function generateIcons() {
  const grid = artwork();
  await mkdir(root + 'extension/icons', {recursive: true});
  await mkdir(root + 'assets/brand', {recursive: true});
  for (const size of [16, 32, 48, 128]) await writeFile(root + `extension/icons/${size}.png`, png(grid, size));
  await writeFile(root + 'assets/brand/xvc-icon.png', png(grid, 512));
  const rectangles = grid.flatMap((row, y) => row.flatMap((fill, x) => fill ? [`  <rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`] : []));
  await writeFile(root + 'assets/brand/xvc-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="512" height="512" shape-rendering="crispEdges" role="img" aria-labelledby="title">\n  <title id="title">XVC — colorful pixel lettering</title>\n${rectangles.join('\n')}\n</svg>\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateIcons();
