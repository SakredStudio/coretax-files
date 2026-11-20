import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../dev/build.mjs';
import { fileTypes } from '../src/index.js';

test('hosted build: scripts sit under the per-deploy folder and every sample is shipped', async () => {
  const out = await mkdtemp(join(tmpdir(), 'coretax-files-'));
  try {
    await build(out, 'testbuild');
    const html = await readFile(join(out, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ['./b/testbuild/web/app.js']);
    assert.ok(!/<link[^>]+rel="stylesheet"/.test(html), 'a stylesheet would need a per-deploy URL too');
    assert.match(html, /data-samples="\.\/samples\/"/);
    const files = [
      'b/testbuild/web/app.js', 'b/testbuild/src/index.js', 'b/testbuild/src/faktur-keluaran.js', 'b/testbuild/src/retur-masukan.js',
      'b/testbuild/src/bupot.js', 'b/testbuild/src/common.js', 'b/testbuild/src/messages.js', '.nojekyll',
      ...fileTypes.map((t) => `samples/${t.id}-contoh.csv`),
    ];
    for (const file of files) assert.ok((await stat(join(out, file))).isFile(), file);
    // Nothing but the made-up samples may ship: no official files, no tests, no other data.
    assert.deepEqual((await readdir(join(out, 'samples'))).sort(), fileTypes.map((t) => `${t.id}-contoh.csv`).sort());
    assert.deepEqual((await readdir(out)).sort(), ['.nojekyll', 'b', 'icons', 'index.html', 'samples']);
    // Icons + link-preview image only (2026-11-19).
    assert.deepEqual((await readdir(join(out, 'icons'))).sort(), ['apple-touch-icon.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'social-preview.png']);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
