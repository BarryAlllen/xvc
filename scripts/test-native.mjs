import {spawn, spawnSync} from 'node:child_process';
import {readFile, readdir, mkdir, writeFile, symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createTestServer, localURL} from './dev-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const probeDirectory = root + 'native/build';
await mkdir(probeDirectory, {recursive: true});
const probeBuild = spawnSync('/usr/bin/swiftc', ['-swift-version', '5', '-module-cache-path', root + 'native/build/module-cache',
  root + 'tests/native/FinderClipboardProbe.swift', '-o', probeDirectory + '/xvc-finder-probe'], {stdio: 'inherit'});
assert.equal(probeBuild.status, 0, 'clipboard diagnostic must compile before native tests');
const cache = root + 'test-results/native-' + Date.now();
await mkdir(cache, {recursive: true});
const server = createTestServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
const results = [];
let clipboardFile;
function run(input, {cancel = false, split = false, pickDirectory, onMessage = () => {}} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(root + 'native/build/xvc-host', ['--test'], {env: {...process.env, XVC_TEST_CACHE: cache, XVC_TEST_ALLOW_HTTP: '1', ...(pickDirectory ? {XVC_TEST_PICK_DIRECTORY: pickDirectory} : {})}});
    const events = []; let pending = Buffer.alloc(0), stderr = '', cancelled = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('native test timeout')); }, 30000);
    child.stdin.on('error', () => {});
    function send(value) {
      const json = Buffer.from(JSON.stringify(value)), h = Buffer.alloc(4); h.writeUInt32LE(json.length);
      child.stdin.write(Buffer.concat([h, json]));
    }
    child.stdout.on('data', data => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 4 && pending.length >= pending.readUInt32LE() + 4) {
        const size = pending.readUInt32LE(); assert.ok(size < 1_048_576);
        const message = JSON.parse(pending.subarray(4, 4 + size)); events.push(message); pending = pending.subarray(4 + size);
        onMessage(message);
        if (cancel && !cancelled && message.type === 'progress' && message.received > 0) { cancelled = true; send({type: 'cancel', jobId: input.jobId}); }
      }
    });
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error('native exited ' + code + ': ' + stderr)); else resolve({events, result: events.at(-1), stderr}); });
    if (split) {
      const data = Buffer.from(JSON.stringify(input)), h = Buffer.alloc(4); h.writeUInt32LE(data.length);
      child.stdin.write(h.subarray(0, 2));
      setTimeout(() => { child.stdin.write(Buffer.concat([h.subarray(2), data.subarray(0, 3)])); setTimeout(() => child.stdin.write(data.subarray(3)), 10); }, 10);
    } else send(input);
  });
}
async function checkClipboardUnchanged() {
  if (!clipboardFile) return;
  const r = spawnSync(root + 'native/build/xvc-finder-probe', ['inspect', clipboardFile], {encoding: 'utf8'});
  assert.equal(r.status, 0, 'failed tasks must not replace the last successful clipboard entry (its old cache is intentionally removed)');
  assert.equal(JSON.parse(r.stdout).fileObjectsReadable, true);
}
async function test(name, fn) {
  try { const detail = await fn(); results.push({name, passed: true, ...detail}); console.log('PASS ' + name); }
  catch (error) { results.push({name, passed: false, error: error.stack}); console.error('FAIL ' + name + ': ' + error.message); throw error; }
}
try {
  await test('native framing supports partial header and body', async () => {
    const {result} = await run({type: 'ping'}, {split: true}); assert.equal(result.type, 'ready');
  });
  for (const [name, expected] of [['sample.mp4', 43528], ['below-limit.mp4', 24_999_999], ['exact-limit.mp4', 25_000_000]]) {
    await test('download → validated MP4 → native clipboard: ' + name, async () => {
      const {result, events} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/' + name]});
      assert.equal(result.type, 'success', JSON.stringify(result)); assert.equal(result.verified, true); assert.equal(result.clipboardType, 'public.file-url'); assert.equal(result.bytes, expected);
      assert.match(result.filename, /^xvc-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\.mp4$/);
      clipboardFile = cache + '/' + result.filename;
      const data = await readFile(clipboardFile); assert.equal(data.length, expected); assert.equal(createHash('sha256').update(data).digest('hex'), result.sha256);
      assert.deepEqual((await readdir(cache)).filter(n => n.endsWith('.mp4')), [result.filename], 'only the current video is retained');
      await checkClipboardUnchanged();
      assert.equal(events.at(-2).stage, 'clipboard'); assert.ok(events.filter(e => e.type === 'progress').every(e => e.progress < 1));
      return {bytes: data.length, sha256: result.sha256};
    });
  }
  await test('new task clears recent history and partials before downloading, even when the new video fails', async () => {
    const previous = clipboardFile;
    const orphan = cache + '/' + randomUUID() + '.part.mp4';
    const outside = root + 'test-results/cache-safety-' + randomUUID();
    const link = cache + '/XVC-' + randomUUID() + '.mp4';
    await writeFile(orphan, 'incomplete'); await writeFile(outside, 'keep outside cache'); await symlink(outside, link);
    let removedAtStart = false;
    const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/not-video.mp4']}, {
      onMessage(message) {
        if (message.stage === 'checking') removedAtStart = [previous, orphan, link, cache + '/current.json'].every(path => !existsSync(path));
      }
    });
    assert.equal(removedAtStart, true, 'history is removed before the first download progress');
    assert.equal(result.code, 'INVALID_MP4'); assert.equal(await readFile(outside, 'utf8'), 'keep outside cache');
    assert.deepEqual(await readdir(cache), [], 'a failed new task leaves no historical videos');
    await checkClipboardUnchanged();
  });
  for (const [name, code] of [['over-limit.mp4', 'TOO_LARGE'], ['unknown-over.mp4', 'TOO_LARGE'], ['not-video.mp4', 'INVALID_MP4'], ['redirect-bad.mp4', 'SOURCE']]) {
    await test('reject without changing clipboard: ' + name, async () => {
      const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/' + name]});
      assert.equal(result.type, 'error'); assert.equal(result.code, code); await checkClipboardUnchanged();
    });
  }
  await test('over-limit quality falls back to smaller valid MP4', async () => {
    const {result} = await run({type: 'copy', jobId: randomUUID(), urls: ['over-limit.mp4', 'sample.mp4'].map(n => localURL + '/fixtures/' + n)});
    assert.equal(result.type, 'success'); assert.equal(result.bytes, 43528); clipboardFile = cache + '/' + result.filename;
    await checkClipboardUnchanged();
    assert.deepEqual((await readdir(cache)).filter(n => n.endsWith('.mp4')), [result.filename]);
  });
  await test('concurrent browser tasks cannot delete the active download', async () => {
    let notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const first = run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/slow.mp4']}, {
      onMessage(message) { if (message.type === 'progress' && message.received > 0) notifyStarted(); }
    });
    await started;
    const parts = (await readdir(cache)).filter(n => n.endsWith('.part.mp4'));
    assert.equal(parts.length, 1);
    const {result: second} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/sample.mp4']});
    assert.equal(second.code, 'BUSY'); assert.equal(existsSync(cache + '/' + parts[0]), true);
    const {result} = await first; assert.equal(result.type, 'success'); clipboardFile = cache + '/' + result.filename;
    assert.deepEqual((await readdir(cache)).filter(n => n.endsWith('.mp4')), [result.filename]);
    await checkClipboardUnchanged();
  });
  await test('cancel in-flight transfer without changing clipboard', async () => {
    const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/slow.mp4']}, {cancel: true});
    assert.equal(result.code, 'CANCELLED'); await checkClipboardUnchanged();
  });
  await test('reject arbitrary local paths and non-X sources', async () => {
    for (const source of ['file:///etc/passwd', 'https://example.com/test.mp4', 'https://video.twimg.com.evil.test/test.mp4']) {
      const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [source]}); assert.equal(result.code, 'SOURCE');
    }
    await checkClipboardUnchanged();
  });
  await test('failed transfers leave no partial files', async () => { assert.equal((await readdir(cache)).filter(n => n.includes('.part')).length, 0); });
  await test('preferences persist across processes and reject invalid values without changing saved state', async () => {
    let {result} = await run({type: 'updateSettings', patch: {maxMB: 1, keepCache: true}});
    assert.equal(result.ok, true); assert.equal(result.settings.maxMB, 1);
    for (const patch of [{maxMB: 0}, {maxMB: 501}, {maxMB: 1.5}, {maxMB: true}, {unlimited: 1}, {keepCache: 'yes'}, {cachePath: '/tmp'}]) {
      const {result: invalid} = await run({type: 'updateSettings', patch}); assert.equal(invalid.code, 'SETTINGS');
    }
    ({result} = await run({type: 'ping'}));
    assert.deepEqual(result.settings, {maxMB: 1, unlimited: false, keepCache: true});
  });
  await test('custom limit enforces exact boundary, actual streamed bytes and ignores page overrides', async () => {
    for (const name of ['above-1mb.mp4', 'unknown-over.mp4']) {
      const {result} = await run({type: 'copy', jobId: randomUUID(), maxMB: 500, urls: [localURL + '/fixtures/' + name]});
      assert.equal(result.code, 'TOO_LARGE'); assert.match(result.message, /1 MB/);
    }
    const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/exact-1mb.mp4']});
    assert.equal(result.type, 'success'); assert.equal(result.bytes, 1_000_000); clipboardFile = cache + '/' + result.filename;
  });
  await test('unlimited bypasses the former 25 MB cap and retention keeps earlier videos', async () => {
    const previous = clipboardFile;
    await run({type: 'updateSettings', patch: {unlimited: true}});
    const {result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/over-limit.mp4']});
    assert.equal(result.type, 'success'); assert.equal(result.bytes, 25_000_001); assert.equal(existsSync(previous), true);
    clipboardFile = cache + '/' + result.filename;
    assert.notEqual(clipboardFile, previous, 'retained videos have unique names');
    await checkClipboardUnchanged();
  });
  await test('directory changes and preferences are blocked while a transfer holds the global lock', async () => {
    let notify;
    const started = new Promise(resolve => { notify = resolve; });
    const first = run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/slow.mp4']}, {onMessage(m) { if (m.received > 0) notify(); }});
    await started;
    for (const type of ['updateSettings', 'resetSettings', 'chooseDirectory']) {
      const {result} = await run({type, patch: {keepCache: false}}, {pickDirectory: cache + '-destination'}); assert.equal(result.code, 'BUSY');
    }
    const {result} = await first; assert.equal(result.type, 'success'); clipboardFile = cache + '/' + result.filename;
  });
  await test('directory picker uses a dedicated subfolder, preserves old files and resets ALL defaults', async () => {
    const previous = clipboardFile;
    const parent = cache + '-destination'; await mkdir(parent); await writeFile(parent + '/my-video.mp4', 'user file');
    let {result} = await run({type: 'chooseDirectory'}, {pickDirectory: parent});
    assert.equal(result.cacheDirectory, parent + '/XVC-videos');
    assert.equal(existsSync(previous), true); assert.equal(await readFile(parent + '/my-video.mp4', 'utf8'), 'user file');
    const changed = result.cacheDirectory;
    ({result} = await run({type: 'copy', jobId: randomUUID(), urls: [localURL + '/fixtures/sample.mp4']}));
    assert.equal(result.type, 'success'); clipboardFile = changed + '/' + result.filename; assert.equal(existsSync(clipboardFile), true);
    ({result} = await run({type: 'resetSettings'}));
    assert.deepEqual(result.settings, {maxMB: 25, unlimited: false, keepCache: false}); assert.equal(result.cacheDirectory, cache);
    assert.equal(existsSync(clipboardFile), true, 'reset must not delete a file referenced by the clipboard');
    ({result} = await run({type: 'ping'})); assert.equal(result.cacheDirectory, cache); assert.equal(result.settings.maxMB, 25);
    await checkClipboardUnchanged();
  });
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(root + 'test-results/native-validation.json', JSON.stringify({date: new Date().toISOString(), cache, clipboardFile, results}, null, 2));
}
