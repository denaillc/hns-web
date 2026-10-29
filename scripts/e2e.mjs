// Test de bout en bout : lance le build dans un Chromium headless, joue
// quelques secondes et vérifie qu'il n'y a pas d'erreur. Captures dans screenshots/.
//
//   npm run build && npm run e2e
//
// Variables : CHROMIUM_PATH (binaire Chromium), E2E_PORT (défaut 4173).
import { launch, OUT } from './lib.mjs';

const { browser, page, server, errors } = await launch();
try {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-title.png` });

  await page.click('button[data-action="new"]');
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => window.__game.debugState());
  console.log('start', await state());
  await page.screenshot({ path: `${OUT}/02-start.png` });

  // Se balader et frapper.
  const cx = 640;
  const cy = 380;
  await page.mouse.move(cx + 200, cy);
  const dirs = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  for (let i = 0; i < 8; i++) {
    const k = dirs[i % 4];
    await page.keyboard.down(k);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.keyboard.up(k);
    await page.mouse.click(cx + 150, cy - 50, { button: 'right' });
    await page.keyboard.press('Space');
  }
  console.log('after walk', await state());
  await page.screenshot({ path: `${OUT}/03-walk.png` });

  // Téléporte le joueur près de monstres pour un vrai combat.
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.enemies.find((x) => !x.dead);
    if (e) g.player.pos.set(e.pos.x + 3, 0, e.pos.z + 3);
    g.player.invulnerable = 999;
  });
  for (let i = 0; i < 30; i++) {
    const pos = await page.evaluate(() => {
      const g = window.__game;
      const e = g.enemies.filter((x) => !x.dead).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
      if (!e) return null;
      const o = { x: 0, y: 0, visible: false };
      g.project(e.pos, o);
      // Avance vers la cible.
      const d = e.pos.clone().sub(g.player.pos);
      if (d.length() > 2) g.player.pos.addScaledVector(d.normalize(), 0.8);
      return o;
    });
    if (!pos) break;
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    if (i % 5 === 0) await page.mouse.click(pos.x, pos.y, { button: 'right' });
    if (i === 12) await page.screenshot({ path: `${OUT}/04-combat.png` });
  }
  console.log('after combat', await state());
  await page.screenshot({ path: `${OUT}/05-after-combat.png` });

  // Inventaire.
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-inventory.png` });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(400);

  // Portail → halte → étage suivant.
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(g.world.portalPosition.x, 0, g.world.portalPosition.z + 0.5);
  });
  await page.waitForFunction(() => window.__game.state === 'halt', null, { timeout: 5000 }).catch(() => {});
  console.log('portal', (await state()).state);
  await page.screenshot({ path: `${OUT}/07-halt.png` });
  if ((await state()).state === 'halt') {
    await page.click('button[data-action="descend"]');
    await page.waitForTimeout(800);
  }
  console.log('floor 2', await state());

  // Mesure FPS (SwiftShader : indicatif seulement).
  await page.waitForTimeout(2000);
  console.log('fps (logiciel)', (await state()).fps);
  await page.screenshot({ path: `${OUT}/08-floor2.png` });

  // Mort du joueur.
  await page.evaluate(() => {
    const g = window.__game;
    g.player.invulnerable = 0;
    g.damagePlayer(99999, g.player.pos);
  });
  await page.waitForTimeout(2200);
  console.log('death', (await state()).state);
  await page.screenshot({ path: `${OUT}/09-death.png` });
} finally {
  await browser.close();
  server.kill();
}

if (errors.length) {
  console.error('\n❌ Erreurs détectées :\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✅ Aucun erreur JS pendant la session.');
