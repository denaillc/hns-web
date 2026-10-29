// Utilitaires communs aux scripts de test navigateur.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const OUT = 'screenshots';

async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const mod = await import('@sparticuz/chromium');
    return await mod.default.executablePath();
  } catch {
    return undefined; // Playwright utilisera son navigateur installé
  }
}

/** Démarre `vite preview` + Chromium headless (WebGL via SwiftShader) et ouvre le jeu. */
export async function launch({ width = 1280, height = 760 } = {}) {
  mkdirSync(OUT, { recursive: true });
  const port = Number(process.env.E2E_PORT ?? 41000 + Math.floor(Math.random() * 8000));
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview ne démarre pas')), 20000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('http')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const browser = await chromium.launch({
    executablePath: await chromiumPath(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.stack ?? e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|ERR_NAME|ERR_CONNECTION/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  const close = async () => {
    await browser.close();
    server.kill();
  };
  return { browser: { close }, page, server: { kill() {} }, errors };
}
