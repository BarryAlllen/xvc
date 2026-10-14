import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('This diagnostic requires macOS.');
const directory = fileURLToPath(new URL('./build/', import.meta.url));
const binary = fileURLToPath(new URL('./build/xvc-native-probe', import.meta.url));
const source = fileURLToPath(new URL('./NativeMemoryProbe.swift', import.meta.url));
await mkdir(directory, {recursive: true});
const compiled = spawnSync('swiftc', [source, '-o', binary], {stdio: 'inherit'});
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
const result = spawnSync(binary, process.argv.slice(2), {stdio: 'inherit'});
process.exit(result.status ?? 1);
