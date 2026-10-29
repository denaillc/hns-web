// Captures rapprochées pour vérifier modèles, animations et découpe des murs.
import { launch, OUT } from './lib.mjs';
const { browser, page, errors } = await launch({ width: 1100, height: 700 });
try {
  await page.click('button[data-action="new"]');
  await page.waitForTimeout(600);
  // Zoom avant.
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await page.mouse.move(800, 350);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/close-1.png` });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/close-2.png` });
  await page.mouse.up();
  // Contre le mur sud : la découpe doit laisser voir le joueur.
  await page.evaluate(() => {
    const g = window.__game;
    const d = g.dungeon;
    const r = d.rooms[d.startRoom];
    g.player.pos.set((r.cx + 0.5) * 2, 0, (r.y + r.h) * 2 - 0.6);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/close-wall.png` });
  // Un monstre de chaque type devant le joueur.
  await page.evaluate(() => {
    const g = window.__game;
    const d = g.dungeon;
    const r = d.rooms[d.startRoom];
    g.player.pos.set((r.cx + 0.5) * 2, 0, (r.cy + 2) * 2);
    g.player.invulnerable = 999;
    const kinds = ['skeleton', 'archer', 'bat', 'brute', 'necro'];
    kinds.forEach((k, i) => {
      const e = g.spawnEnemy(k, g.player.pos.clone().add({ x: (i - 2) * 2.2, y: 0, z: -5 }), i === 3);
      e.aggro = false;
    });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/close-bestiary.png` });
} finally {
  await browser.close();
}
if (errors.length) console.error(errors);
process.exit(0);
