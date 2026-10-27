#!/usr/bin/env node
/**
 * Verifies the Vite production build actually emits MapLibre's ESM worker
 * and that a Map can load GeoJSON through that worker (not the SPA HTML fallback).
 *
 * Prerequisites: `npm run build` (dist/ present).
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'dist', 'assets');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(assetsDir)) {
  fail('dist/assets missing — run npm run build first');
}

const assets = readdirSync(assetsDir);
const workerFiles = assets.filter(
  (f) => /worker/i.test(f) && /\.(m)?js$/.test(f),
);
if (workerFiles.length === 0) {
  fail(
    `no worker asset in dist/assets (found: ${assets.join(', ') || '(empty)'})`,
  );
}

const workerFile = workerFiles[0];
const workerHead = readFileSync(path.join(assetsDir, workerFile), 'utf8').slice(
  0,
  240,
);
if (workerHead.includes('<!DOCTYPE') || workerHead.includes('<html')) {
  fail(`${workerFile} looks like HTML (SPA fallback), not a worker`);
}

const appJs = assets.filter((f) => f.endsWith('.js'));
const referencesWorker = appJs.some((f) => {
  const body = readFileSync(path.join(assetsDir, f), 'utf8');
  return body.includes(workerFile);
});
if (!referencesWorker) {
  fail(
    `built JS does not reference emitted worker ${workerFile} — setWorkerUrl(?worker&url) may be missing`,
  );
}

console.log(`ok: emitted worker ${workerFile} referenced by app bundle`);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const smokeHtml = `<!doctype html>
<html><head><meta charset="utf-8"/><title>pending</title>
<style>html,body,#map{margin:0;height:100%;width:100%;background:#ddd}</style>
</head><body>
<div id="map"></div>
<script type="module">
window.__result = { ok: false, stage: 'boot' };
window.addEventListener('error', (e) => {
  window.__result = { ok: false, stage: 'window-error', error: String(e.message || e.error) };
});
window.addEventListener('unhandledrejection', (e) => {
  window.__result = { ok: false, stage: 'unhandledrejection', error: String(e.reason) };
});
import * as maplibregl from '/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
maplibregl.setWorkerUrl('/assets/${workerFile}');
const poly = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { id: 'smoke' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[34.7, 31.4], [35.3, 31.4], [35.3, 32.0], [34.7, 32.0], [34.7, 31.4]]],
    },
  }],
};
let map;
try {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: { smoke: { type: 'geojson', data: poly } },
      layers: [{
        id: 'smoke-fill',
        type: 'fill',
        source: 'smoke',
        paint: { 'fill-color': '#c00', 'fill-opacity': 0.8 },
      }],
    },
    center: [35.0, 31.7],
    zoom: 6,
    attributionControl: false,
  });
} catch (err) {
  window.__result = { ok: false, stage: 'construct', error: String(err?.message || err) };
  throw err;
}
map.on('error', (e) => {
  window.__result = {
    ok: false,
    stage: 'map-error',
    error: String(e.error?.message || e.error || e),
  };
});
map.on('load', () => {
  window.__result = { ...window.__result, stage: 'load', mapLoaded: true };
  const tryQuery = () => {
    const feats = map.queryRenderedFeatures(map.project([35.0, 31.7]), {
      layers: ['smoke-fill'],
    });
    if (feats.length > 0) {
      window.__result = {
        ok: true,
        stage: 'query',
        featureCount: feats.length,
        mapLoaded: true,
        workerUrl: maplibregl.getWorkerUrl?.() || '(n/a)',
      };
      return true;
    }
    return false;
  };
  if (tryQuery()) return;
  let n = 0;
  const id = setInterval(() => {
    n += 1;
    if (tryQuery()) {
      clearInterval(id);
      return;
    }
    if (n > 60) {
      clearInterval(id);
      if (!window.__result.ok) {
        window.__result = {
          ok: false,
          stage: 'query-timeout',
          featureCount: 0,
          mapLoaded: true,
          error: window.__result.error,
        };
      }
    }
  }, 200);
});
</script>
</body></html>`;

function contentType(filePath) {
  return mime[path.extname(filePath)] || 'application/octet-stream';
}

const workerRequests = [];

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/smoke.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(smokeHtml);
    return;
  }
  if (urlPath.startsWith('/assets/')) {
    const base = path.basename(urlPath);
    if (base === workerFile) {
      workerRequests.push({ url: urlPath, at: Date.now() });
    }
    const file = path.join(assetsDir, base);
    if (!existsSync(file)) {
      res.writeHead(404).end('missing');
      return;
    }
    // Deliberately do NOT fall back to index.html for unknown assets.
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(readFileSync(file));
    return;
  }
  if (urlPath.startsWith('/node_modules/')) {
    const file = path.join(root, urlPath.slice(1));
    if (!existsSync(file)) {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file) });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(404).end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const smokeUrl = `http://127.0.0.1:${port}/smoke.html`;

const chromePath =
  process.env.CHROME_PATH ||
  (existsSync('/usr/bin/google-chrome')
    ? '/usr/bin/google-chrome'
    : undefined);

const userDataDir = path.join(root, '.tmp-chrome-maplibre-smoke');
rmSync(userDataDir, { recursive: true, force: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--enable-webgl2',
  ],
});

const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => {
  consoleErrors.push(String(err));
});

await page.goto(smokeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

const result = await page.waitForFunction(
  () => {
    const r = window.__result;
    if (!r) return false;
    if (r.ok === true) return true;
    if (r.stage === 'map-error' || r.stage === 'construct' || r.stage === 'query-timeout') {
      return true;
    }
    return false;
  },
  { timeout: 30000 },
).then(() => page.evaluate(() => window.__result));

const screenshotPath = path.join(root, '.tmp-maplibre-worker-smoke.png');
await page.screenshot({ path: screenshotPath, fullPage: true });

await browser.close();
server.close();

console.log('result:', JSON.stringify(result));
console.log('worker HTTP fetches:', workerRequests.length);
if (consoleErrors.length) {
  console.log('console errors:', consoleErrors.slice(0, 8));
}

if (workerRequests.length === 0) {
  fail('browser never requested the built worker asset');
}
if (!result?.ok) {
  fail(
    `GeoJSON layer did not load via built worker: ${JSON.stringify(result)}`,
  );
}

console.log(
  `ok: built MapLibre worker loaded GeoJSON (features=${result.featureCount})`,
);
console.log(`screenshot: ${screenshotPath}`);
