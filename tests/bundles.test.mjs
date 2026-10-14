import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('each Chrome execution world has one self-contained entry and initializes its own media core', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.content_scripts.length, 2);
  const entries = manifest.content_scripts.map(s => { assert.equal(s.js.length, 1); return s.js[0]; });
  assert.notEqual(entries[0], entries[1]);
  for (const name of entries) {
    const listeners = [];
    const context = {URL, console, crypto: {randomUUID: () => 'test'}, location: {origin: 'https://x.com'},
      setTimeout, clearTimeout, addEventListener() {},
      document: {addEventListener() {}},
      chrome: {runtime: {onMessage: {addListener: fn => listeners.push(fn)}}},
      XMLHttpRequest: function () {}};
    context.XMLHttpRequest.prototype.open = () => {};
    context.window = context;
    context.postMessage = () => {};
    context.fetch = () => Promise.resolve({ok: false});
    vm.runInNewContext(await readFile(new URL('../extension/' + name, import.meta.url), 'utf8'), context);
    assert.equal(typeof context.XVCMedia.selectVideo, 'function');
    assert.equal(typeof context.XVCMedia.sanitizeMedia, 'function');
  }
});
