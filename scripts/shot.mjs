#!/usr/bin/env node
/**
 * Screenshot helper for visual QA (headless Chromium with software WebGL).
 *
 * Usage:
 *   node scripts/shot.mjs <path-or-url> [more...] [--out dir] [--w 1280] [--h 800] [--wait 2500]
 *
 *   <path-or-url>  e.g. "gallery.html?p=ControlLogixRack" or "/#/mission/1-1" or a full http URL.
 *                  Paths are served by an on-demand Vite dev server (random port) started by this script.
 *   --out          output directory (default: screenshots/tmp). File names are derived from the path.
 *   --name         explicit file name (only when a single target is given)
 *   --wait         ms to wait after load before capturing (default 2500; WebGL on SwiftShader is slow)
 *
 * Prints the written PNG paths and any page console errors. Open the PNGs with the Read tool to inspect.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opts = { out: 'screenshots/tmp', w: 1280, h: 800, wait: 2500, name: undefined };
const targets = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) opts[a.slice(2)] = args[++i];
  else targets.push(a);
}
if (targets.length === 0) {
  console.error('usage: node scripts/shot.mjs <path-or-url> [...] [--out dir] [--w 1280] [--h 800] [--wait 2500]');
  process.exit(1);
}

let server;
let base = '';
if (targets.some((t) => !/^https?:/.test(t))) {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error', clearScreen: false });
  await server.listen();
  const addr = server.httpServer.address();
  base = `http://127.0.0.1:${addr.port}`;
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
fs.mkdirSync(opts.out, { recursive: true });
try {
  for (const t of targets) {
    const url = /^https?:/.test(t) ? t : `${base}/${t.replace(/^\//, '')}`;
    const page = await browser.newPage({ viewport: { width: Number(opts.w), height: Number(opts.h) } });
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(Number(opts.wait));
    const file = path.join(
      opts.out,
      (targets.length === 1 && opts.name) || `${t.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}.png`,
    );
    await page.screenshot({ path: file });
    console.log(`wrote ${file}`);
    for (const e of errors.slice(0, 10)) console.log(`  console error: ${e.slice(0, 400)}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server?.close();
}
