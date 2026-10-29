// Scénario : saute à l'étage 3 (boss), combat le Roi-Liche avec un personnage
// renforcé, vérifie l'ouverture du portail. Captures dans screenshots/boss-*.png.
import { launch, OUT } from './lib.mjs';

const { browser, page, errors } = await launch();
try {
  await page.click('button[data-action="new"]');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const g = window.__game;
    g.character.floor = 2;
    g.character.level = 8;
    g.nextFloor();
  });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const g = window.__game;
    const boss = g.enemies.find((e) => e.isBoss);
    return { floor: g.character.floor, bossFloor: g.bossFloor, portal: g.portalActive, boss: boss ? { hp: boss.hp, x: boss.pos.x, z: boss.pos.z } : null };
  });
  console.log('boss floor', info);
  if (!info.boss) throw new Error('Pas de boss à l’étage 3');

  // Le joueur apparaît face au boss.
  await page.evaluate(() => {
    const g = window.__game;
    const boss = g.enemies.find((e) => e.isBoss);
    for (const e of g.enemies) if (!e.isBoss) e.removed = true;
    g.player.pos.set(g.world.portalPosition.x, 0, g.world.portalPosition.z + 2.5);
    g.player.stats.maxHp = g.player.hp = 5000;
  });
  for (let i = 0; i < 45; i++) {
    const r = await page.evaluate(() => {
      const g = window.__game;
      const boss = g.enemies.find((e) => e.isBoss && !e.dead);
      if (!boss) return null;
      const o = { x: 0, y: 0, visible: false };
      g.project(boss.pos, o);
      const d = boss.pos.clone().sub(g.player.pos);
      if (d.length() > 3) g.player.pos.addScaledVector(d.normalize(), 0.6);
      return { ...o, hp: boss.hp, state: boss.state };
    });
    if (!r) break;
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    if (i === 6) await page.screenshot({ path: `${OUT}/boss-1.png` });
    if (i === 20) await page.screenshot({ path: `${OUT}/boss-2.png` });
    // Accélère le combat.
    if (i === 10) await page.evaluate(() => { const b = window.__game.enemies.find((e) => e.isBoss); b.hp = b.maxHp * 0.6; });
    if (i === 22) await page.evaluate(() => { const b = window.__game.enemies.find((e) => e.isBoss); b.hp = b.maxHp * 0.3; });
    if (i === 30 || i === 40) await page.evaluate(() => { const b = window.__game.enemies.find((e) => e.isBoss); b.hp = 30; });
  }
  await page.waitForTimeout(1000);
  const end = await page.evaluate(() => ({ portal: window.__game.portalActive, pickups: window.__game.pickups.length, state: window.__game.state }));
  console.log('fin', end);
  await page.screenshot({ path: `${OUT}/boss-3.png` });
  if (!end.portal) throw new Error('Portail non ouvert après la mort du boss');
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('\n❌ Erreurs :\n' + errors.join('\n'));
  process.exit(1);
}
console.log('✅ Scénario boss OK');
