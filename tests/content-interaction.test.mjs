import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

// Run the actual content script before the site's delegated media handlers.
// X treats a secondary-button press on its player as a playback interaction.
function setup({muted = true, volume = 0.35, paused = true} = {}) {
  const listeners = {window: new Map(), document: new Map()};
  const register = scope => (type, fn, options) => {
    const handlers = listeners[scope].get(type) || [];
    handlers.push({fn, capture: options === true || options?.capture === true});
    listeners[scope].set(type, handlers);
  };
  class Element {
    closest(selector) {
      if (selector === '#xvc-ui') return null;
      if (selector.startsWith('article')) return this.article || null;
      if (selector.includes('videoPlayer')) return this.player || null;
      return null;
    }
    contains(node) { return node === this || node === video; }
  }
  const article = new Element();
  const video = Object.assign(new Element(), {muted, volume, paused, article,
    getBoundingClientRect: () => ({left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100})});
  article.querySelectorAll = () => [video];
  const overlay = Object.assign(new Element(), {article, player: new Element()});
  const text = Object.assign(new Element(), {article});
  const context = {Element, console, setTimeout, clearTimeout,
    location: {origin: 'https://x.com'},
    document: {addEventListener: register('document')},
    addEventListener: register('window'), postMessage() {},
    chrome: {runtime: {onMessage: {addListener() {}}}}};
  context.window = context;
  vm.runInNewContext(source, context);
  const reachedSite = [];
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'click']) {
    register('document')(type, event => {
      reachedSite.push(type);
      // Model the observed X handler; any leaked event may start/unmute playback.
      if (event.target === video || event.target === overlay) {
        video.muted = false;
        video.volume = 1;
        video.paused = false;
      }
    }, true);
  }
  function dispatch(type, options = {}) {
    let stopped = false;
    const event = {type, target: overlay, clientX: 50, clientY: 50,
      button: 2, ctrlKey: false, isTrusted: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { stopped = true; }, ...options};
    for (const [scope, capture] of [['window', true], ['document', true], ['document', false], ['window', false]]) {
      for (const handler of listeners[scope].get(type) || []) {
        if (handler.capture !== capture) continue;
        handler.fn(event);
        if (stopped) return event;
      }
    }
    return event;
  }
  return {video, overlay, text, dispatch, reachedSite};
}

for (const initial of [
  {muted: true, volume: 0.35, paused: true},
  {muted: false, volume: 0.6, paused: false},
]) {
  test(`right-click preserves media state (${JSON.stringify(initial)})`, () => {
    const {video, dispatch, reachedSite} = setup(initial);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) dispatch(type);
    assert.deepEqual({muted: video.muted, volume: video.volume, paused: video.paused}, initial);
    assert.deepEqual(reachedSite, []);
  });
}

test('macOS Control-click also preserves muted playback', () => {
  const {video, dispatch, reachedSite} = setup();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) dispatch(type, {button: 0, ctrlKey: true});
  assert.equal(video.muted, true);
  assert.equal(video.paused, true);
  assert.deepEqual(reachedSite, []);
});

test('normal left-click still reaches the player controls', () => {
  const {video, dispatch, reachedSite} = setup();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    assert.equal(dispatch(type, {button: 0}).defaultPrevented, false);
  }
  assert.equal(video.muted, false);
  assert.equal(reachedSite.length, 5);
});

test('right-click outside the video and untrusted events are untouched', () => {
  const {dispatch, text, reachedSite} = setup();
  assert.equal(dispatch('pointerdown', {target: text, clientX: 250}).defaultPrevented, false);
  assert.equal(dispatch('pointerdown', {isTrusted: false}).defaultPrevented, false);
  assert.deepEqual(reachedSite, ['pointerdown', 'pointerdown']);
});
