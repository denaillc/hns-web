// Mesure grossière du coût CPU par frame (JS vs rendu) dans Chromium headless.
import { launch } from './lib.mjs';
const { browser, page, errors } = await launch();
try {
  await page.click('button[data-action="new"]');
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const render = g.renderer.render.bind(g.renderer);
    let tRender = 0, n = 0;
    g.renderer.render = (s, c) => { const t = performance.now(); render(s, c); tRender += performance.now() - t; n++; };
    const step = g.step.bind(g);
    let tStep = 0;
    g.step = (dt) => { const t = performance.now(); step(dt); tStep += performance.now() - t; };
    const ui = g.ui.update.bind(g.ui);
    let tUi = 0;
    g.ui.update = (dt) => { const t = performance.now(); ui(dt); tUi += performance.now() - t; };
    await new Promise((res) => setTimeout(res, 3000));
    return { frames: n, render: tRender / n, step: tStep / n, ui: tUi / n, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
  });
  console.log(r);
} finally {
  await browser.close();
}
if (errors.length) console.error(errors);
process.exit(0);
