import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = await readFile(root + 'tests/fixtures/sample.mp4');
export const localURL = 'http://127.0.0.1:4173';
const jobs = new Map();
const bridgeCache = root + 'test-results/ui-cache';
const sizes = {'sample.mp4': sample.length, 'exact-1mb.mp4': 1_000_000, 'above-1mb.mp4': 1_000_001, 'below-limit.mp4': 24_999_999, 'exact-limit.mp4': 25_000_000, 'over-limit.mp4': 25_000_001, 'unknown-over.mp4': 25_000_001, 'slow.mp4': 4_000_000};
function startBridge(url) {
  if (!['slow.mp4', 'sample.mp4', 'over-limit.mp4'].some(name => url === localURL + '/fixtures/' + name)) throw new Error('Only UI test fixtures are allowed');
  const jobId = randomUUID();
  const child = spawn(root + 'native/build/xvc-host', ['--test'], {env: {...process.env, XVC_TEST_CACHE: bridgeCache, XVC_TEST_ALLOW_HTTP: '1'}, stdio: ['pipe', 'pipe', 'pipe']});
  const job = {child, events: []}; jobs.set(jobId, job);
  let pending = Buffer.alloc(0);
  child.stdout.on('data', data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE()) {
      const size = pending.readUInt32LE(); job.events.push(JSON.parse(pending.subarray(4, 4 + size))); pending = pending.subarray(4 + size);
    }
  });
  child.on('error', error => job.events.push({type: 'error', jobId, code: 'TEST_BRIDGE', message: error.message}));
  child.on('close', () => { setTimeout(() => jobs.delete(jobId), 60000).unref(); });
  const data = Buffer.from(JSON.stringify({type: 'copy', jobId, urls: [url]}));
  const header = Buffer.alloc(4); header.writeUInt32LE(data.length); child.stdin.write(Buffer.concat([header, data]));
  return jobId;
}
export function createTestServer() {
  return http.createServer(async (request, response) => {
    try {
      const u = new URL(request.url, localURL);
      response.setHeader('Cache-Control', 'no-store');
      if (u.pathname === '/bridge/start' && request.method === 'POST') {
        if (request.headers.origin !== localURL) { response.writeHead(403); response.end(); return; }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({jobId: startBridge(u.searchParams.get('url'))})); return;
      }
      if (u.pathname === '/bridge/events') {
        if (request.headers['sec-fetch-site'] === 'cross-site') { response.writeHead(403); response.end(); return; }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(jobs.get(u.searchParams.get('id'))?.events || [])); return;
      }
      if (u.pathname === '/bridge/cancel' && request.method === 'POST') {
        if (request.headers.origin !== localURL) { response.writeHead(403); response.end(); return; }
        const jobId = u.searchParams.get('id'), job = jobs.get(jobId);
        if (job) {
          const data = Buffer.from(JSON.stringify({type: 'cancel', jobId})); const h = Buffer.alloc(4); h.writeUInt32LE(data.length);
          job.child.stdin.write(Buffer.concat([h, data]));
        }
        response.end('{}'); return;
      }
      if (u.pathname.startsWith('/fixtures/')) {
        const name = u.pathname.slice(10);
        if (name === 'not-video.mp4') { response.writeHead(200, {'Content-Type': 'video/mp4'}); response.end('<html>not a video</html>'); return; }
        if (name === 'redirect-bad.mp4') { response.writeHead(302, {Location: 'https://example.com/file.mp4'}); response.end(); return; }
        const size = sizes[name]; if (!size) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Type', 'video/mp4');
        if (name !== 'unknown-over.mp4') response.setHeader('Content-Length', size);
        if (request.method === 'HEAD') { response.end(); return; }
        response.write(sample);
        let remaining = size - sample.length;
        if (remaining) { const header = Buffer.alloc(8); header.writeUInt32BE(remaining); header.write('free', 4); response.write(header); remaining -= 8; }
        while (remaining > 0 && !response.destroyed) {
          const count = Math.min(remaining, 65536);
          if (!response.write(Buffer.alloc(count))) await new Promise(resolve => {
            const finish = () => { response.off('drain', finish); response.off('close', finish); resolve(); };
            response.once('drain', finish); response.once('close', finish);
          });
          remaining -= count;
          if (name === 'slow.mp4') await new Promise(resolve => setTimeout(resolve, 70));
        }
        response.end(); return;
      }
      const allowed = {'/': 'tests/demo.html', '/demo.js': 'tests/demo.js', '/media-core.js': 'extension/media-core.js', '/content.js': 'extension/content.js'};
      if (!allowed[u.pathname]) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
      response.end(await readFile(root + allowed[u.pathname]));
    } catch (error) { if (!response.headersSent) response.writeHead(500); response.end(String(error.message)); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(bridgeCache, {recursive: true});
  createTestServer().listen(4173, '127.0.0.1', () => console.log('XVC test UI: ' + localURL));
}
