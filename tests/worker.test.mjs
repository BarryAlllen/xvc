import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const core = await readFile(new URL('../extension/media-core.js', import.meta.url), 'utf8');
const worker = (await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8')).replace("import './media-core.js';", '');
function setup() {
  let receiver;
  const sent = [], ports = [];
  const event = () => ({addListener(fn) { this.fire = fn; }});
  const chrome = {
    runtime: {onMessage: {addListener(fn) { receiver = fn; }}, getURL: p => 'chrome-extension://test/' + p,
      connectNative() { const port = {onMessage: event(), onDisconnect: event(), inputs: [], postMessage(m) { this.inputs.push(m); }, disconnect() { this.disconnected = true; }}; ports.push(port); return port; }},
    tabs: {sendMessage: async (tab, message) => { sent.push({tab, message}); }, onRemoved: event(), onUpdated: event()}
  };
  const context = vm.createContext({URL, chrome, setTimeout, clearTimeout});
  vm.runInContext(core, context); vm.runInContext(worker, context);
  return {chrome, sent, ports, receive: (m, s, r = () => {}) => receiver(m, s, r)};
}
const sender = {url: 'https://x.com/home', frameId: 0, tab: {id: 11}};
const request = () => ({type: 'XVC_START', jobId: randomUUID(), urls: ['https://video.twimg.com/ext_tw_video/1/pu/vid/test.mp4']});
test('a completed download alone can never produce copy success', async () => {
  const s = setup(), r = request(); s.receive(r, sender);
  s.ports[0].onMessage.fire({type: 'success', jobId: r.jobId, clipboardType: 'web video/mp4', verified: true});
  assert.equal(s.sent[0].message.type, 'error'); assert.equal(s.sent[0].message.code, 'UNVERIFIED');
});
test('native file URL and explicit readback acknowledgement are required', async () => {
  const s = setup(), r = request(); s.receive(r, sender);
  s.ports[0].onMessage.fire({type: 'progress', jobId: r.jobId, stage: 'clipboard', progress: .98});
  assert.equal(s.sent[0].message.type, 'progress');
  s.ports[0].onMessage.fire({type: 'success', jobId: r.jobId, clipboardType: 'public.file-url', verified: true});
  assert.equal(s.sent[1].message.type, 'success');
});
test('other sites, subframes and local paths cannot launch the native downloader', () => {
  const s = setup();
  s.receive(request(), {...sender, url: 'https://evil.test'});
  s.receive(request(), {...sender, frameId: 2});
  s.receive({...request(), urls: ['file:///etc/passwd']}, sender);
  assert.equal(s.ports.length, 0);
});
test('host disconnect before success is an error, and stale job events are ignored', () => {
  const s = setup(), r = request(); s.receive(r, sender);
  s.ports[0].onMessage.fire({type: 'success', jobId: randomUUID(), clipboardType: 'public.file-url', verified: true});
  assert.equal(s.sent.length, 0);
  s.ports[0].onDisconnect.fire();
  assert.equal(s.sent[0].message.type, 'error');
});
test('closing or navigating away disconnects and cancels native work', () => {
  const s = setup(); s.receive(request(), sender); s.chrome.tabs.onUpdated.fire(11, {status: 'loading'});
  assert.equal(s.ports[0].disconnected, true);
});
