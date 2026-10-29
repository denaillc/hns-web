import * as THREE from 'three';
import {
  addToInventory,
  autoEquipIfEmpty,
  gainXp,
  newCharacter,
  type Character,
} from '../core/character';
import { generateDungeon, type Dungeon } from '../core/dungeon';
import { FlowField } from '../core/flowfield';
import { generateItem, RARITY_LABELS, type Item, type Rarity } from '../core/loot';
import { randomSeed, Rng } from '../core/rng';
import { clearSave, loadSave, loadSettings, saveSettings, updateRecords, writeSave, type Settings } from '../core/save';
import { mitigate } from '../core/stats';
import { Audio } from './audio';
import type { FloatKind, GameCtx, HitOptions } from './context';
import { Enemy, type EnemyKind } from './enemies';
import { Input } from './input';
import { Particles } from './particles';
import { makePickupMesh, type Pickup, type PickupKind } from './pickups';
import { Player, SKILLS } from './player';
import { Projectiles, Telegraphs, type ProjectileSpec } from './projectiles';
import { buildWorld, Collision, tileCenter, toTile, TILE, wallUniforms, type WorldView } from './world';
import { UI } from '../ui/ui';

export type GameState = 'menu' | 'playing' | 'paused' | 'inventory' | 'dead' | 'halt';

const BOSS_EVERY = 3;

export class Game implements GameCtx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles = new Particles(3500);
  readonly audio = new Audio();
  readonly input: Input;
  readonly ui: UI;
  settings: Settings;

  state: GameState = 'menu';
  time = 0;
  rng = new Rng(randomSeed());
  character: Character = newCharacter();
  player!: Player;
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  dungeon!: Dungeon;
  world: WorldView | null = null;
  collision!: Collision;
  flow!: FlowField;
  floorSeed = 0;
  explored = new Uint8Array(0);
  portalActive = false;
  bossFloor = false;
  floorKills = 0;
  floorGold = 0;
  floorStart = 0;

  private projectiles: Projectiles;
  private telegraphs: Telegraphs;
  private sun: THREE.DirectionalLight;
  private torchLights: THREE.PointLight[] = [];
  private torchTimer = 0;
  private flowTimer = 0;
  private exploreTimer = 0;
  private shakeAmount = 0;
  private zoom = 1;
  private hitStop = 0;
  private aim = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);
  private readonly camTarget = new THREE.Vector3();
  private last = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;
  hovered: Enemy | null = null;
  private bagFullWarnAt = -10;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 200);
    this.scene.background = new THREE.Color(0x070605);
    this.scene.fog = new THREE.FogExp2(0x070605, 0.022);

    const hemi = new THREE.HemisphereLight(0x8a9ab8, 0x2a1e14, 0.32);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0x9fb2d8, 0.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -22;
    sc.right = sc.top = 22;
    sc.near = 1;
    sc.far = 70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 11, 1.8);
      this.scene.add(l);
      this.torchLights.push(l);
    }
    this.scene.add(this.particles.points);
    this.projectiles = new Projectiles(this.scene);
    this.telegraphs = new Telegraphs(this.scene);

    this.input = new Input(canvas);
    this.applyQuality();
    this.audio.volume = this.settings.volume;
    this.audio.muted = this.settings.muted;
    this.ui = new UI(uiRoot, this);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setState('paused');
    });
    this.resize();

    // Un étage de fond pour l'écran titre.
    this.character = newCharacter();
    this.loadFloor(randomSeed(), true);
    this.ui.showTitle(!!loadSave());
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------------------
  // Cycle de vie d'une partie
  // ---------------------------------------------------------------------------

  newGame(): void {
    this.audio.unlock();
    clearSave();
    this.character = newCharacter();
    // Équipement de départ.
    const r = new Rng(randomSeed());
    this.character.equipment.weapon = generateItem(r, 1, { slot: 'weapon', rarity: 'common' });
    this.character.equipment.weapon.name = 'Épée de recrue';
    this.character.equipment.armor = generateItem(r, 1, { slot: 'armor', rarity: 'common' });
    this.character.equipment.armor.name = 'Gambison usé';
    this.floorSeed = randomSeed();
    writeSave(this.character, this.floorSeed);
    this.loadFloor(this.floorSeed);
    this.setState('playing');
    this.ui.banner(`Étage ${this.character.floor}`, floorName(this.character.floor));
  }

  continueGame(): boolean {
    const save = loadSave();
    if (!save) return false;
    this.audio.unlock();
    this.character = save.character;
    this.floorSeed = save.floorSeed;
    this.loadFloor(this.floorSeed);
    this.setState('playing');
    this.ui.banner(`Étage ${this.character.floor}`, floorName(this.character.floor));
    return true;
  }

  /** Recommence l'étage courant tel qu'il était au début (après une mort). */
  retryFloor(): void {
    if (!this.continueGame()) this.newGame();
  }

  nextFloor(): void {
    this.character.floor++;
    this.floorSeed = randomSeed();
    updateRecords(this.character, 0);
    writeSave(this.character, this.floorSeed);
    this.loadFloor(this.floorSeed);
    this.setState('playing');
    this.ui.banner(`Étage ${this.character.floor}`, floorName(this.character.floor));
  }

  setState(s: GameState): void {
    this.state = s;
    this.input.reset();
    this.ui.onStateChange(s);
  }

  /** Applique le réglage de qualité graphique (ombres, résolution, lumières). */
  applyQuality(): void {
    const high = this.settings.quality !== 'low';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 1.75) : 1);
    this.renderer.shadowMap.enabled = high;
    this.sun.castShadow = high;
    this.torchLights.forEach((l, i) => (l.visible = high || i < 2));
    // Les matériaux doivent être recompilés quand le nombre de lumières / les ombres changent.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    this.resize();
  }

  saveSettings(): void {
    this.audio.volume = this.settings.volume;
    this.audio.muted = this.settings.muted;
    this.audio.applyVolume();
    saveSettings(this.settings);
  }

  private loadFloor(seed: number, demo = false): void {
    // Nettoyage.
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    for (const e of this.enemies) this.scene.remove(e.root);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    if (this.player) {
      this.scene.remove(this.player.root);
    }
    this.enemies = [];
    this.pickups = [];
    this.projectiles.clear();
    this.telegraphs.clear();
    this.particles.clear();

    const floor = this.character.floor;
    this.rng = new Rng(seed);
    this.bossFloor = !demo && floor % BOSS_EVERY === 0;
    this.dungeon = generateDungeon(seed, { rooms: Math.min(14, 8 + Math.floor(floor / 2)) });
    this.collision = new Collision(this.dungeon);
    this.flow = new FlowField(this.dungeon.tiles, this.dungeon.w, this.dungeon.h, 34);
    this.explored = new Uint8Array(this.dungeon.w * this.dungeon.h);
    this.world = buildWorld(this.dungeon, seed, Math.floor((floor - 1) / BOSS_EVERY));
    this.scene.add(this.world.group);

    this.player = new Player(this.character);
    this.player.attach(this.scene);
    const start = this.dungeon.rooms[this.dungeon.startRoom];
    this.player.pos.copy(tileCenter(start.cx, start.cy));
    this.player.facing = Math.PI;
    this.camTarget.copy(this.player.pos);

    this.populate();
    this.portalActive = !this.bossFloor;
    this.world.setPortalActive(this.portalActive);
    this.floorKills = 0;
    this.floorGold = 0;
    this.floorStart = this.time;
    this.flow.compute(start.cx, start.cy);
    this.ui.onFloorLoaded();
  }

  /** Place les meutes de monstres dans les salles. */
  private populate(): void {
    const d = this.dungeon;
    const floor = this.character.floor;
    const rng = this.rng;
    const kinds: EnemyKind[] = ['skeleton', 'archer', 'bat', 'brute', 'necro'];
    const weights = [
      10,
      floor >= 1 ? 4 : 0,
      floor >= 2 ? 3 : 0,
      floor >= 2 ? 2 + floor * 0.3 : 0,
      floor >= 3 ? 1.5 + floor * 0.2 : 0,
    ];
    d.rooms.forEach((room, i) => {
      if (i === d.startRoom) return;
      if (this.bossFloor && i === d.exitRoom) {
        const boss = this.spawnEnemy('boss', tileCenter(room.cx, room.cy - 2));
        if (boss) boss.facing = Math.PI;
        return;
      }
      const packs = room.w * room.h > 100 ? 2 : 1;
      for (let p = 0; p < packs; p++) {
        const kind = rng.weighted(kinds, weights);
        const count = kind === 'bat' ? rng.int(4, 6) : kind === 'brute' ? rng.int(1, 2) : kind === 'necro' ? 1 : rng.int(3, 4 + Math.floor(floor / 3));
        const cx = rng.int(room.x + 2, room.x + room.w - 3);
        const cy = rng.int(room.y + 2, room.y + room.h - 3);
        const eliteChance = 0.07 + floor * 0.015;
        const hasElite = rng.chance(eliteChance);
        for (let n = 0; n < count; n++) {
          const pos = tileCenter(cx, cy).add(new THREE.Vector3(rng.range(-2.5, 2.5), 0, rng.range(-2.5, 2.5)));
          if (!this.collision.isWalkable(pos.x, pos.z) || this.collision.circleHitsWall(pos.x, pos.z, 0.6)) continue;
          this.spawnEnemy(kind, pos, hasElite && n === 0);
        }
        // Escorte de squelettes pour les nécromanciens.
        if (kind === 'necro') {
          for (let n = 0; n < 2; n++) {
            const pos = tileCenter(cx, cy).add(new THREE.Vector3(rng.range(-2, 2), 0, rng.range(-2, 2)));
            if (this.collision.isWalkable(pos.x, pos.z) && !this.collision.circleHitsWall(pos.x, pos.z, 0.6)) this.spawnEnemy('skeleton', pos);
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // GameCtx
  // ---------------------------------------------------------------------------

  get floor(): number {
    return this.character.floor;
  }

  spawnEnemy(kind: EnemyKind, pos: THREE.Vector3, elite = false): Enemy | null {
    const e = new Enemy(kind, pos, this.character.floor, elite);
    this.scene.add(e.root);
    this.enemies.push(e);
    return e;
  }

  spawnProjectile(p: ProjectileSpec): void {
    this.projectiles.spawn(p);
  }

  addTelegraph(pos: THREE.Vector3, radius: number, duration: number, onFire: () => void, color?: number): void {
    this.telegraphs.add(pos, radius, duration, onFire, color);
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1, Math.max(this.shakeAmount, amount));
  }

  floatText(pos: THREE.Vector3, text: string, kind: FloatKind): void {
    if (!this.settings.showDamageNumbers && (kind === 'dmg' || kind === 'crit')) return;
    this.ui.floatText(pos, text, kind);
  }

  damageEnemy(e: Enemy, amount: number, opts: HitOptions = {}): void {
    if (e.dead) return;
    e.takeHit(amount, opts.from, opts.knockback ?? 0, this.time);
    if (opts.slow) {
      e.slowAmount = opts.slow;
      e.slowUntil = this.time + (opts.slowFor ?? 2);
    }
    const at = e.pos.clone().setY(e.rig.height * 0.6 * (e.isBoss ? 1 : 1));
    this.floatText(at, `${amount}`, opts.crit ? 'crit' : 'dmg');
    const blood = e.kind === 'brute' ? 0x6a9a3a : e.kind === 'bat' ? 0x8a2030 : e.kind === 'necro' ? 0x55ff88 : 0xe8e0c8;
    this.particles.burst(at, opts.color ?? blood, opts.crit ? 16 : 8, opts.crit ? 6 : 4, { size: 0.22, life: 0.45 });
    this.audio.play(opts.crit ? 'crit' : 'hit');
    if (opts.crit) this.hitStop = Math.max(this.hitStop, 0.05);
    if (!opts.spell) this.player.onMeleeHit();
    if (e.dead) this.onEnemyKilled(e);
  }

  damagePlayer(amount: number, from: THREE.Vector3): void {
    const p = this.player;
    if (p.dead || p.invulnerable > 0 || this.state !== 'playing') return;
    const dmg = Math.max(1, Math.round(mitigate(amount, p.stats.armor) * this.rng.range(0.9, 1.1)));
    p.hp -= dmg;
    p.hurtFlash();
    this.floatText(p.pos.clone().setY(2.2), `-${dmg}`, 'player');
    this.shake(0.2 + Math.min(0.3, dmg / p.stats.maxHp));
    this.audio.play('hurt');
    this.particles.burst(p.pos.clone().setY(1.2), 0xb01020, 8, 3, { size: 0.2 });
    this.ui.hurtVignette(dmg / p.stats.maxHp);
    void from;
    if (p.hp <= 0) this.onPlayerDeath();
  }

  // ---------------------------------------------------------------------------
  // Événements de jeu
  // ---------------------------------------------------------------------------

  private onEnemyKilled(e: Enemy): void {
    const c = this.character;
    c.kills++;
    this.floorKills++;
    this.audio.play('death');
    this.particles.burst(e.pos.clone().setY(1), e.kind === 'necro' ? 0x66ff99 : 0xd8d0b8, e.isBoss ? 120 : 22, e.isBoss ? 10 : 5, { size: 0.3, life: 0.8 });
    const xp = e.xp;
    this.floatText(e.pos.clone().setY(2.6), `+${xp} XP`, 'xp');
    const levels = gainXp(c, xp);
    if (levels > 0) this.onLevelUp(levels);
    this.dropLoot(e);
    if (e.isBoss) {
      this.portalActive = true;
      this.world?.setPortalActive(true);
      this.audio.play('portal');
      this.shake(0.8);
      this.ui.banner('Morvhal est vaincu !', 'Le portail vers les profondeurs est ouvert');
      for (const o of this.enemies) if (!o.dead && o !== e) this.damageEnemy(o, o.hp + 1, { spell: true });
    }
  }

  private onLevelUp(levels: number): void {
    const p = this.player;
    p.refreshStats();
    p.fullHeal();
    this.audio.play('levelup');
    this.particles.ring(p.pos, 0.6, 0xffd36a, 60, { speed: 7, size: 0.5, life: 0.8 });
    this.particles.burst(p.pos.clone().setY(1.5), 0xfff0b0, 40, 4, { gravity: -3, life: 1.2 });
    const unlocked = SKILLS.filter((s) => s.unlock > this.character.level - levels && s.unlock <= this.character.level);
    const sub = unlocked.length ? `Nouvelle compétence : ${unlocked.map((s) => `${s.name} (${this.input.label(s.key)})`).join(', ')}` : 'Vie et mana restaurées';
    this.ui.banner(`Niveau ${this.character.level} !`, sub);
  }

  private onPlayerDeath(): void {
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    this.audio.play('death');
    this.shake(0.6);
    updateRecords(this.character, 0);
    setTimeout(() => {
      if (this.player === p && p.dead) this.setState('dead');
    }, 1600);
  }

  private dropLoot(e: Enemy): void {
    const rng = this.rng;
    const floor = this.character.floor;
    const ilvl = floor * 2 + Math.floor(this.character.level / 2);
    const at = e.pos.clone();
    const goldAmount = () => Math.round(rng.range(3, 9) * (1 + floor * 0.35) * (e.elite ? 3 : 1));
    if (e.isBoss) {
      for (let i = 0; i < 6; i++) this.spawnPickup('gold', at, goldAmount() * 2);
      this.spawnPickup('item', at, 1, generateItem(rng, ilvl + 2, { rarity: 'legendary' }));
      this.spawnPickup('item', at, 1, generateItem(rng, ilvl + 2, { rarity: 'rare' }));
      this.spawnPickup('item', at, 1, generateItem(rng, ilvl + 1, { magicFind: 2 }));
      this.spawnPickup('potion', at, 1);
      this.spawnPickup('potion', at, 1);
      return;
    }
    if (rng.chance(e.elite ? 1 : 0.55)) this.spawnPickup('gold', at, goldAmount());
    const itemChance = e.elite ? 1 : e.kind === 'brute' || e.kind === 'necro' ? 0.3 : e.kind === 'bat' ? 0.05 : 0.11;
    if (rng.chance(itemChance)) {
      const mf = e.elite ? 1.5 : floor * 0.08;
      let rarity: Rarity | undefined;
      if (e.elite && rng.chance(0.7)) rarity = rng.chance(0.25) ? 'rare' : 'magic';
      this.spawnPickup('item', at, 1, generateItem(rng, ilvl, { magicFind: mf, rarity }));
    }
    if (e.elite && rng.chance(0.5)) this.spawnPickup('item', at, 1, generateItem(rng, ilvl, { magicFind: 1 }));
    if (rng.chance(e.elite ? 0.5 : 0.05)) this.spawnPickup('potion', at, 1);
  }

  private spawnPickup(kind: PickupKind, at: THREE.Vector3, amount: number, item?: Item): void {
    const mesh = makePickupMesh(kind, item);
    const a = this.rng.range(0, Math.PI * 2);
    const s = this.rng.range(1.5, 3.5);
    const pos = at.clone().setY(0.6);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.pickups.push({
      kind,
      pos,
      vel: new THREE.Vector3(Math.cos(a) * s, 5, Math.sin(a) * s),
      amount,
      item,
      mesh,
      age: 0,
      blockedUntil: 0,
      taken: false,
    });
    if (item && (item.rarity === 'legendary' || item.rarity === 'rare')) this.audio.play(item.rarity === 'legendary' ? 'legendary' : 'pickup');
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const c = this.character;
    for (const k of this.pickups) {
      k.age += dt;
      // Petit saut à l'apparition.
      if (k.vel.lengthSq() > 0) {
        k.vel.y -= 18 * dt;
        const nx = k.pos.x + k.vel.x * dt;
        const nz = k.pos.z + k.vel.z * dt;
        if (this.collision.isWalkable(nx, k.pos.z)) k.pos.x = nx;
        else k.vel.x = 0;
        if (this.collision.isWalkable(k.pos.x, nz)) k.pos.z = nz;
        else k.vel.z = 0;
        k.pos.y += k.vel.y * dt;
        if (k.pos.y <= 0) {
          k.pos.y = 0;
          k.vel.set(0, 0, 0);
        }
      }
      const dist = Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z);
      if (k.age > 0.5 && !p.dead && (k.kind === 'gold' || (k.kind === 'potion' && c.potions < 5)) && dist < 3.2) {
        // Aimantation.
        const pull = Math.min(1, dt * 12);
        k.pos.x += (p.pos.x - k.pos.x) * pull;
        k.pos.z += (p.pos.z - k.pos.z) * pull;
      }
      if (k.age > 0.5 && dist < (k.kind === 'item' ? 1.1 : 0.8) && !p.dead) this.tryTake(k);
      k.mesh.position.copy(k.pos);
      const gem = k.mesh.getObjectByName('gem');
      if (gem) {
        gem.rotation.y += dt * 2;
        gem.position.y = 0.5 + Math.sin(this.time * 3 + k.pos.x) * 0.08;
      }
      if (k.kind === 'potion') k.mesh.rotation.y += dt;
    }
    this.pickups = this.pickups.filter((k) => {
      if (k.taken) this.scene.remove(k.mesh);
      return !k.taken;
    });
  }

  private tryTake(k: Pickup): void {
    const c = this.character;
    switch (k.kind) {
      case 'gold':
        c.gold += k.amount;
        this.floorGold += k.amount;
        this.floatText(k.pos.clone().setY(1.2), `+${k.amount} or`, 'gold');
        this.audio.play('gold');
        k.taken = true;
        break;
      case 'potion':
        if (c.potions >= 5) return;
        c.potions++;
        this.floatText(k.pos.clone().setY(1.2), '+1 potion', 'heal');
        this.audio.play('pickup');
        k.taken = true;
        break;
      case 'item': {
        const item = k.item!;
        if (autoEquipIfEmpty(c, item)) {
          this.player.refreshStats();
          this.ui.toast(`Équipé : <span class="r-${item.rarity}">${item.name}</span>`);
        } else if (!addToInventory(c, item)) {
          if (this.time - this.bagFullWarnAt > 3) {
            this.bagFullWarnAt = this.time;
            this.floatText(this.player.pos.clone().setY(2.4), 'Sac plein ! (I pour recycler)', 'info');
            this.audio.play('error');
          }
          return;
        } else {
          this.ui.toast(`Ramassé : <span class="r-${item.rarity}">${item.name}</span> <em>(${RARITY_LABELS[item.rarity]})</em>`);
        }
        this.audio.play('pickup');
        k.taken = true;
        this.ui.onInventoryChanged();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boucle principale
  // ---------------------------------------------------------------------------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const ratio = this.renderer.getPixelRatio();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h * ratio);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.handleGlobalKeys();

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.15;
    }

    const simulate = this.state === 'playing' || this.state === 'dead';
    if (simulate) this.step(dt);
    else if (this.state === 'menu') this.menuStep(dt);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.ui.update(dt);
    this.input.endFrame();
  };

  private handleGlobalKeys(): void {
    const i = this.input;
    if (i.wasPressed('Escape')) {
      if (this.state === 'playing') this.setState('paused');
      else if (this.state === 'paused' || this.state === 'inventory') this.setState('playing');
    }
    if (i.wasPressed('KeyI') || i.wasPressed('Tab') || i.wasPressed('KeyC')) {
      if (this.state === 'playing') this.setState('inventory');
      else if (this.state === 'inventory') this.setState('playing');
    }
    if (i.wasPressed('KeyM')) {
      this.settings.muted = !this.settings.muted;
      this.saveSettings();
      this.ui.toast(this.settings.muted ? 'Son coupé' : 'Son activé');
    }
    if (i.wasPressed('KeyP')) this.ui.toggleFps();
  }

  private menuStep(dt: number): void {
    this.time += dt;
    // Caméra qui dérive lentement dans le donjon de fond.
    const r = this.dungeon.rooms;
    const k = (this.time * 0.03) % r.length;
    const a = r[Math.floor(k)];
    const b = r[(Math.floor(k) + 1) % r.length];
    const f = k - Math.floor(k);
    const s = f * f * (3 - 2 * f);
    this.player.pos.set(
      THREE.MathUtils.lerp(a.cx, b.cx, s) * TILE,
      0,
      THREE.MathUtils.lerp(a.cy, b.cy, s) * TILE,
    );
    this.player.root.visible = false;
    this.world?.update(this.time);
    this.particles.update(dt);
    this.updateTorchLights(dt);
    this.sun.position.copy(this.player.pos).add(new THREE.Vector3(-8, 20, 10));
    this.sun.target.position.copy(this.player.pos);
  }

  private step(dt: number): void {
    this.time += dt;
    const p = this.player;
    p.root.visible = true;

    // Point visé par la souris (plan horizontal à hauteur de torse).
    const ndc = new THREE.Vector2((this.input.mouseX / window.innerWidth) * 2 - 1, -(this.input.mouseY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.aimPlane, this.aim);
    this.hovered = Player.pickTarget(this.enemies, this.aim);
    const aimPoint = this.hovered ? this.hovered.pos : this.aim;

    if (this.state === 'playing') p.update(dt, this, this.input, aimPoint);
    else p.update(dt, this, emptyInput(this.input), aimPoint);

    // Champ de flux vers le joueur.
    this.flowTimer -= dt;
    const ptx = toTile(p.pos.x);
    const pty = toTile(p.pos.z);
    if (this.flowTimer <= 0 && (ptx !== this.flow.targetX || pty !== this.flow.targetY)) {
      this.flow.compute(ptx, pty);
      this.flowTimer = 0.2;
    }

    for (const e of this.enemies) {
      // Les monstres loin et endormis ne sont pas simulés.
      if (!e.aggro && !e.dead && e.pos.distanceToSquared(p.pos) > 30 * 30) continue;
      e.update(dt, this);
    }
    this.enemies = this.enemies.filter((e) => {
      if (e.removed) this.scene.remove(e.root);
      return !e.removed;
    });

    this.projectiles.update(dt, this);
    this.telegraphs.update(dt);
    this.updatePickups(dt);
    this.particles.update(dt);
    this.world?.update(this.time);
    this.updateTorchLights(dt);

    // Exploration (minimap).
    this.exploreTimer -= dt;
    if (this.exploreTimer <= 0) {
      this.exploreTimer = 0.15;
      this.reveal(ptx, pty, 7);
    }

    // Portail.
    if (this.world && this.state === 'playing' && !p.dead) {
      const d = Math.hypot(p.pos.x - this.world.portalPosition.x, p.pos.z - this.world.portalPosition.z);
      if (this.portalActive) {
        if (Math.random() < dt * 30) {
          const a = Math.random() * Math.PI * 2;
          this.particles.emit({
            x: this.world.portalPosition.x + Math.cos(a) * 1.2,
            y: 1.5 + Math.sin(a) * 1.2,
            z: this.world.portalPosition.z + 0.1,
            vx: -Math.cos(a) * 1.5,
            vy: -Math.sin(a) * 1.5,
            color: 0x8ab8ff,
            size: 0.35,
            life: 0.8,
            drag: 0,
          });
        }
        if (d < 1.4) this.enterPortal();
      }
    }

    // Ombres et découpe des murs centrées sur le joueur.
    this.sun.position.copy(p.pos).add(new THREE.Vector3(-8, 20, 10));
    this.sun.target.position.copy(p.pos);
    wallUniforms.uPlayer.value.copy(p.pos);
  }

  private enterPortal(): void {
    this.audio.play('portal');
    updateRecords(this.character, this.floorKills);
    this.setState('halt');
  }

  private reveal(tx: number, ty: number, r: number): void {
    const d = this.dungeon;
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
        if ((x - tx) ** 2 + (y - ty) ** 2 <= r * r) this.explored[y * d.w + x] = 1;
      }
  }

  private updateTorchLights(dt: number): void {
    if (!this.world) return;
    this.torchTimer -= dt;
    const torches = this.world.torches;
    if (this.torchTimer <= 0) {
      this.torchTimer = 0.3;
      const p = this.player.pos;
      const sorted = [...torches].sort((a, b) => a.position.distanceToSquared(p) - b.position.distanceToSquared(p));
      this.torchLights.forEach((l, i) => {
        const t = sorted[i];
        if (t) {
          l.position.copy(t.position).add(new THREE.Vector3(0, 0.2, 0.5));
          l.userData.phase = t.phase;
          l.userData.on = true;
        } else l.userData.on = false;
      });
    }
    for (const l of this.torchLights) {
      if (!l.userData.on) {
        l.intensity = 0;
        continue;
      }
      const ph = l.userData.phase as number;
      l.intensity = 9 + Math.sin(this.time * 12 + ph) * 1.5 + Math.sin(this.time * 7.7 + ph * 3) * 1.2;
    }
    // Étincelles des torches visibles.
    if (Math.random() < dt * 20) {
      const l = this.torchLights[Math.floor(Math.random() * this.torchLights.length)];
      if (l.userData.on)
        this.particles.emit({ x: l.position.x + (Math.random() - 0.5) * 0.15, y: l.position.y + 0.1, z: l.position.z - 0.4, vy: 1.5, color: 0xffa040, size: 0.18, life: 0.6, drag: 0.5 });
    }
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    if (this.input.wheel !== 0 && this.state === 'playing') this.zoom = THREE.MathUtils.clamp(this.zoom + this.input.wheel * 0.08, 0.65, 1.35);
    const lerp = 1 - Math.exp(-dt * (this.state === 'menu' ? 2 : 8));
    this.camTarget.lerp(p.pos, lerp);
    const offset = new THREE.Vector3(0, 15, 10.5).multiplyScalar(this.zoom);
    this.camera.position.copy(this.camTarget).add(offset);
    if (this.shakeAmount > 0) {
      const s = this.shakeAmount * this.shakeAmount * 0.6;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.5);
    }
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 0.8, this.camTarget.z);
  }

  /** Projette un point du monde en coordonnées écran (px). */
  project(v: THREE.Vector3, out: { x: number; y: number; visible: boolean }): void {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = p.z < 1 && p.x > -1.1 && p.x < 1.1 && p.y > -1.1 && p.y < 1.1;
  }

  /** État exposé pour les tests automatisés (scripts/e2e.mjs). */
  debugState() {
    return {
      state: this.state,
      floor: this.character.floor,
      level: this.character.level,
      hp: Math.round(this.player.hp),
      maxHp: Math.round(this.player.stats.maxHp),
      enemies: this.enemies.filter((e) => !e.dead).length,
      kills: this.character.kills,
      pickups: this.pickups.length,
      inventory: this.character.inventory.length,
      fps: this.fps,
      player: { x: this.player.pos.x, z: this.player.pos.z },
      portal: this.world ? { x: this.world.portalPosition.x, z: this.world.portalPosition.z } : null,
      drawCalls: this.renderer.info.render.calls,
    };
  }
}

/** Entrée « vide » utilisée quand le joueur est mort (plus de contrôle). */
function emptyInput(real: Input): Input {
  return Object.assign(Object.create(Object.getPrototypeOf(real)), {
    keys: new Set(),
    pressed: new Set(),
    mouseLeft: false,
    mouseRight: false,
    layout: real.layout,
  }) as Input;
}

export function floorName(floor: number): string {
  const names = ['Cryptes d’Ombrefer', 'Catacombes Murmurantes', 'Ossuaire Pourpre', 'Abysses Verdâtres'];
  return names[Math.floor((floor - 1) / BOSS_EVERY) % names.length] + (floor % BOSS_EVERY === 0 ? ' — Antre du Roi-Liche' : '');
}
