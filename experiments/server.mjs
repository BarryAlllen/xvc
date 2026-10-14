import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const sample = await readFile(new URL('../tests/fixtures/sample.mp4', import.meta.url));
const assets = new Map(['probe.html', 'probe.js', 'mp4.js', 'probe.css'].map(name => ['/' + name, new URL('./extension/' + name, import.meta.url)]));
const lengths = {'sample.mp4': sample.length, 'below-limit.mp4': 24_999_999, 'exact-limit.mp4': 25_000_000, 'over-limit.mp4': 25_000_001, 'unknown-over.mp4': 25_000_001};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4173');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname.startsWith('/fixtures/')) {
      const name = url.pathname.slice('/fixtures/'.length);
      if (name === 'not-video.mp4') {
        response.writeHead(200, {'Content-Type': 'video/mp4'});
        response.end('<html>This is not a video.</html>');
        return;
      }
      const length = lengths[name];
      if (!length) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', 'video/mp4');
      if (name !== 'unknown-over.mp4') response.setHeader('Content-Length', length);
      if (request.method === 'HEAD') { response.end(); return; }
      response.write(sample);
      if (length > sample.length) {
        const padding = length - sample.length;
        const header = Buffer.alloc(8);
        header.writeUInt32BE(padding);
        header.write('free', 4);
        response.write(header);
        let remaining = padding - 8;
        const zeros = Buffer.alloc(64 * 1024);
        while (remaining > 0 && !response.destroyed) {
          const count = Math.min(remaining, zeros.length);
          if (!response.write(zeros.subarray(0, count))) {
            await new Promise(resolve => {
              function finish() {
                response.off('drain', finish);
                response.off('close', finish);
                resolve();
              }
              response.once('drain', finish);
              response.once('close', finish);
            });
          }
          remaining -= count;
        }
      }
      response.end();
      return;
    }
    const path = url.pathname === '/' ? '/probe.html' : url.pathname;
    const asset = assets.get(path);
    if (!asset) { response.writeHead(404); response.end(); return; }
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    response.setHeader('Content-Type', type + '; charset=utf-8');
    response.end(await readFile(asset));
  } catch (error) {
    if (!response.headersSent) response.writeHead(500);
    if (!response.destroyed) response.end(error.message);
  }
});
server.listen(4173, '127.0.0.1', () => {
  console.log('XVC 原型 HTTP 源：http://127.0.0.1:4173');
  console.log('加载扩展目录：' + fileURLToPath(new URL('./extension', import.meta.url)));
});
