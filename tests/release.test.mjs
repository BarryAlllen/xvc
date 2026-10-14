import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('package, extension, and native host publish the same version and MIT license', async () => {
  const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
  const pkg = JSON.parse(await read('package.json'));
  const manifest = JSON.parse(await read('extension/manifest.json'));
  const nativeVersion = (await read('native/main.swift')).match(/let version = "([^"]+)"/)?.[1];
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(nativeVersion, pkg.version);
  assert.equal(pkg.license, 'MIT');
  assert.ok((await read('LICENSE')).startsWith('MIT License\n'));
});
