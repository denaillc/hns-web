import * as THREE from 'three';
import {
  equipFromInventory,
  INVENTORY_SIZE,
  MAX_POTIONS,
  potionPrice,
  salvage,
  unequip,
} from '../core/character';
import { FLOOR } from '../core/dungeon';
import {
  itemScore,
  itemStats,
  RARITY_LABELS,
  salvageValue,
  SLOT_LABELS,
  SLOTS,
  type Item,
  type Slot,
} from '../core/loot';
import { loadRecords } from '../core/save';
import { STAT_LABELS, xpToNext, type StatKey } from '../core/stats';
import type { FloatKind } from '../game/context';
import type { Game, GameState } from '../game/Game';
import { floorName } from '../game/Game';
import { SKILLS, type SkillId } from '../game/player';
import { TILE } from '../game/world';

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  dx: number;
}

const SLOT_ICONS: Record<Slot, string> = {
  weapon: '🗡',
  helm: '⛑',
  armor: '🛡',
  gloves: '🧤',
  boots: '👢',
  ring: '💍',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Toute l'interface DOM superposée au canvas. */
export class UI {
  private readonly hud: HTMLElement;
  private readonly floatLayer: HTMLElement;
  private readonly barLayer: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly mmCtx: CanvasRenderingContext2D;
  private floaters: Floater[] = [];
  private floaterPool: HTMLDivElement[] = [];
  private bars = new Map<number, HTMLDivElement>();
  private labels = new Map<string, HTMLDivElement>();
  private hintTimer = 0;
  private bannerTimer = 0;
  private vignetteLevel = 0;
  private showFps = false;
  private mmTimer = 0;
  private readonly proj = { x: 0, y: 0, visible: false };
  private els: Record<string, HTMLElement> = {};
  private skillEls = new Map<SkillId, { root: HTMLElement; cd: HTMLElement; lock: HTMLElement }>();

  constructor(root: HTMLElement, private readonly game: Game) {
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="hurt"></div>
      <div class="bars"></div>
      <div class="floats"></div>
      <div class="hud hidden">
        <div class="top-left">
          <div class="floor-name"></div>
          <div class="info-row"><span class="gold">0</span><span class="kills">0</span></div>
          <div class="objective"></div>
        </div>
        <canvas class="minimap" width="220" height="220"></canvas>
        <div class="target hidden"><div class="target-name"></div><div class="target-bar"><div class="target-fill"></div></div></div>
        <div class="boss hidden"><div class="boss-name"></div><div class="boss-bar"><div class="boss-fill"></div><div class="boss-hp"></div></div></div>
        <div class="bottom">
          <div class="orb hp"><div class="orb-fill"></div><div class="orb-gloss"></div><span class="orb-text"></span></div>
          <div class="center">
            <div class="xp"><div class="xp-fill"></div><span class="xp-text"></span></div>
            <div class="skills"></div>
          </div>
          <div class="orb mana"><div class="orb-fill"></div><div class="orb-gloss"></div><span class="orb-text"></span></div>
        </div>
        <div class="hint-row"></div>
      </div>
      <div class="toasts"></div>
      <div class="banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="screen hidden"></div>
      <div class="tooltip hidden"></div>
      <div class="fps hidden"></div>
    `;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.hud = q('.hud');
    this.floatLayer = q('.floats');
    this.barLayer = q('.bars');
    this.screen = q('.screen');
    this.toasts = q('.toasts');
    this.bannerEl = q('.banner');
    this.tooltip = q('.tooltip');
    this.vignette = q('.hurt');
    this.fpsEl = q('.fps');
    this.minimap = q('.minimap') as HTMLCanvasElement;
    this.mmCtx = this.minimap.getContext('2d')!;
    for (const k of ['floor-name', 'gold', 'kills', 'objective', 'target', 'target-name', 'target-fill', 'boss', 'boss-name', 'boss-fill', 'boss-hp', 'xp-fill', 'xp-text', 'hint-row']) {
      this.els[k] = q('.' + k);
    }
    this.els.hpFill = q('.orb.hp .orb-fill');
    this.els.hpText = q('.orb.hp .orb-text');
    this.els.manaFill = q('.orb.mana .orb-fill');
    this.els.manaText = q('.orb.mana .orb-text');

    const skillsEl = q('.skills');
    for (const s of SKILLS) {
      const el = document.createElement('div');
      el.className = 'skill';
      el.dataset.skill = s.id;
      el.innerHTML = `<span class="skill-icon">${s.icon}</span><span class="skill-key"></span><div class="skill-cd"></div><div class="skill-lock">Niv. ${s.unlock}</div>${s.id === 'potion' ? '<span class="skill-count"></span>' : ''}`;
      skillsEl.appendChild(el);
      this.skillEls.set(s.id, { root: el, cd: el.querySelector('.skill-cd')!, lock: el.querySelector('.skill-lock')! });
      el.addEventListener('mouseenter', () => this.showSkillTooltip(s.id, el));
      el.addEventListener('mouseleave', () => this.hideTooltip());
    }

    // Délégation des clics sur les écrans.
    this.screen.addEventListener('click', (e) => this.onScreenClick(e));
    this.screen.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const it = (e.target as HTMLElement).closest('[data-item]') as HTMLElement | null;
      if (it?.dataset.item) this.salvageItem(it.dataset.item);
    });
    this.screen.addEventListener('mouseover', (e) => {
      const it = (e.target as HTMLElement).closest('[data-item],[data-equipped]') as HTMLElement | null;
      if (!it) return;
      const item = this.findItem(it.dataset.item ?? '', it.dataset.equipped as Slot | undefined);
      if (item) this.showItemTooltip(item, it, !!it.dataset.equipped);
    });
    this.screen.addEventListener('mouseout', (e) => {
      const it = (e.target as HTMLElement).closest('[data-item],[data-equipped]');
      if (it && !it.contains(e.relatedTarget as Node)) this.hideTooltip();
    });
    this.screen.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'volume') {
        this.game.settings.volume = Number(t.value) / 100;
        this.game.saveSettings();
      }
    });
    this.screen.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'muted') this.game.settings.muted = t.checked;
      if (t.name === 'numbers') this.game.settings.showDamageNumbers = t.checked;
      if (t.name === 'quality') {
        this.game.settings.quality = t.checked ? 'low' : 'high';
        this.game.applyQuality();
      }
      this.game.saveSettings();
    });
  }

  // ---------------------------------------------------------------------------
  // Écrans
  // ---------------------------------------------------------------------------

  showTitle(hasSave: boolean): void {
    const rec = loadRecords();
    this.hud.classList.add('hidden');
    this.screen.className = 'screen title';
    this.screen.innerHTML = `
      <div class="title-card">
        <div class="title-kicker">Un hack'n'slash dans votre navigateur</div>
        <h1>Les Cryptes<br/><span>d'Ombrefer</span></h1>
        <div class="menu">
          ${hasSave ? '<button data-action="continue" class="primary">Continuer</button>' : ''}
          <button data-action="new" class="${hasSave ? '' : 'primary'}">Nouvelle partie</button>
          <button data-action="help">Commandes</button>
        </div>
        ${matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches ? '<div class="records warn">Ce jeu se joue au clavier et à la souris.</div>' : ''}
        ${rec.bestFloor > 0 ? `<div class="records">Record : étage ${rec.bestFloor} · niveau ${rec.bestLevel} · ${rec.totalKills} monstres vaincus</div>` : ''}
        <div class="help-box hidden">${this.helpHtml()}</div>
      </div>`;
  }

  private helpHtml(): string {
    const l = (c: string) => `<kbd>${esc(this.game.input.label(c))}</kbd>`;
    return `
      <table class="help">
        <tr><td>${l('KeyW')}${l('KeyA')}${l('KeyS')}${l('KeyD')} / flèches</td><td>Se déplacer</td></tr>
        <tr><td><kbd>Clic gauche</kbd> (maintenu)</td><td>Taille — attaque au corps à corps</td></tr>
        <tr><td><kbd>Clic droit</kbd></td><td>Boule de feu</td></tr>
        <tr><td>${l('Digit1')} ${l('Digit2')} ${l('Digit3')}</td><td>Tourbillon (niv. 2) · Nova de givre (niv. 4) · Météores (niv. 6)</td></tr>
        <tr><td>${l('Space')}</td><td>Roulade (invulnérable)</td></tr>
        <tr><td>${l('KeyF')}</td><td>Boire une potion</td></tr>
        <tr><td>${l('KeyI')} / ${l('Tab')}</td><td>Inventaire et personnage</td></tr>
        <tr><td><kbd>Molette</kbd></td><td>Zoom</td></tr>
        <tr><td><kbd>Échap</kbd> · ${l('KeyM')}</td><td>Pause · couper le son</td></tr>
      </table>
      <p class="help-note">Trouvez le portail de chaque étage pour descendre. Tous les 3 étages, le Roi-Liche garde le passage.</p>`;
  }

  onStateChange(s: GameState): void {
    this.hideTooltip();
    this.game.input.setEnabled(s === 'playing');
    if (s === 'playing') {
      this.screen.className = 'screen hidden';
      this.screen.innerHTML = '';
      this.hud.classList.remove('hidden');
      return;
    }
    this.hud.classList.toggle('hidden', s === 'menu');
    switch (s) {
      case 'paused':
        this.renderPause();
        break;
      case 'inventory':
        this.renderInventory();
        break;
      case 'dead':
        this.renderDeath();
        break;
      case 'halt':
        this.renderHalt();
        break;
      case 'menu':
        this.showTitle(true);
        break;
    }
  }

  private renderPause(): void {
    const st = this.game.settings;
    this.screen.className = 'screen modal';
    this.screen.innerHTML = `
      <div class="panel small">
        <h2>Pause</h2>
        <div class="menu">
          <button data-action="resume" class="primary">Reprendre</button>
          <button data-action="inventory">Inventaire</button>
          <button data-action="quit">Menu principal</button>
        </div>
        <div class="settings">
          <label>Volume <input type="range" name="volume" min="0" max="100" value="${Math.round(st.volume * 100)}" /></label>
          <label><input type="checkbox" name="muted" ${st.muted ? 'checked' : ''}/> Couper le son</label>
          <label><input type="checkbox" name="numbers" ${st.showDamageNumbers ? 'checked' : ''}/> Afficher les dégâts</label>
          <label><input type="checkbox" name="quality" ${st.quality === 'low' ? 'checked' : ''}/> Mode performance (sans ombres)</label>
        </div>
        <details><summary>Commandes</summary>${this.helpHtml()}</details>
      </div>`;
  }

  private renderDeath(): void {
    const c = this.game.character;
    this.screen.className = 'screen modal death';
    this.screen.innerHTML = `
      <div class="panel small">
        <h2 class="blood">Vous êtes mort</h2>
        <p>Étage ${c.floor} · niveau ${c.level} · ${c.kills} monstres vaincus</p>
        <div class="menu">
          <button data-action="retry" class="primary">Réessayer l'étage</button>
          <button data-action="new">Nouvelle partie</button>
          <button data-action="quit">Menu principal</button>
        </div>
        <p class="help-note">« Réessayer » vous ramène au début de l'étage avec l'équipement que vous aviez en y entrant.</p>
      </div>`;
  }

  private renderHalt(): void {
    const g = this.game;
    const c = g.character;
    const price = potionPrice(c);
    const junk = c.inventory.filter((i) => i.rarity === 'common' || i.rarity === 'magic');
    const junkValue = junk.reduce((a, i) => a + salvageValue(i), 0);
    const time = Math.round(g.time - g.floorStart);
    this.screen.className = 'screen modal';
    this.screen.innerHTML = `
      <div class="panel halt">
        <h2>Étage ${c.floor} terminé</h2>
        <div class="halt-stats">
          <div><b>${g.floorKills}</b><span>monstres</span></div>
          <div><b>${g.floorGold}</b><span>or ramassé</span></div>
          <div><b>${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}</b><span>durée</span></div>
        </div>
        <div class="merchant">
          <h3>Le colporteur des profondeurs</h3>
          <p>« Une potion, voyageur ? Les étages suivants sont plus cruels. »</p>
          <div class="merchant-row">
            <span>🧪 Potion de vie (${c.potions}/${MAX_POTIONS})</span>
            <button data-action="buy-potion" ${c.gold < price || c.potions >= MAX_POTIONS ? 'disabled' : ''}>Acheter — ${price} or</button>
          </div>
          <div class="merchant-row">
            <span>♻ Recycler ${junk.length} objet(s) commun(s)/magique(s)</span>
            <button data-action="salvage-junk" ${junk.length === 0 ? 'disabled' : ''}>+${junkValue} or</button>
          </div>
          <div class="merchant-gold">Or : <b>${c.gold}</b></div>
        </div>
        <div class="menu row">
          <button data-action="halt-inventory">Inventaire</button>
          <button data-action="descend" class="primary">Descendre à l'étage ${c.floor + 1}</button>
        </div>
        <p class="help-note">${(c.floor + 1) % 3 === 0 ? '⚠ Le Roi-Liche vous attend à l’étage suivant.' : 'La partie est sauvegardée au début de chaque étage.'}</p>
      </div>`;
  }

  private inventoryFromHalt = false;

  private renderInventory(): void {
    const g = this.game;
    const c = g.character;
    const s = g.player.stats;
    this.screen.className = 'screen modal';
    const equip = SLOTS.map((slot) => {
      const it = c.equipment[slot];
      return `<div class="slot ${it ? 'r-border-' + it.rarity : 'empty'}" ${it ? `data-equipped="${slot}"` : ''} data-slot="${slot}">
        <span class="slot-icon">${SLOT_ICONS[slot]}</span>
        <span class="slot-name">${it ? `<span class="r-${it.rarity}">${esc(it.name)}</span>` : `<em>${SLOT_LABELS[slot]}</em>`}</span>
      </div>`;
    }).join('');
    const cells: string[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const it = c.inventory[i];
      if (!it) {
        cells.push('<div class="cell empty"></div>');
        continue;
      }
      const eq = c.equipment[it.slot];
      const better = !eq || itemScore(it) > itemScore(eq);
      cells.push(`<div class="cell r-border-${it.rarity}" data-item="${it.id}">
        <span class="cell-icon r-${it.rarity}">${SLOT_ICONS[it.slot]}</span>
        ${better ? '<span class="better">▲</span>' : ''}
      </div>`);
    }
    const row = (label: string, v: string) => `<div class="stat"><span>${label}</span><b>${v}</b></div>`;
    const dps = s.damage * (1 + s.damagePct) * (1 + s.critChance * (s.critMult - 1)) * (s.attackSpeed / 0.5);
    this.screen.innerHTML = `
      <div class="panel inventory">
        <button class="close" data-action="${this.inventoryFromHalt ? 'back-halt' : 'resume'}">✕</button>
        <div class="inv-left">
          <h2>Personnage</h2>
          <div class="char-head">Niveau ${c.level} · ${c.xp}/${xpToNext(c.level)} XP</div>
          <div class="equip">${equip}</div>
          <div class="stats">
            ${row('Vie', `${Math.round(g.player.hp)} / ${Math.round(s.maxHp)}`)}
            ${row('Mana', `${Math.round(g.player.mana)} / ${Math.round(s.maxMana)}`)}
            ${row('Dégâts', `${Math.round(s.damage * (1 + s.damagePct))}`)}
            ${row('DPS (Taille)', `${Math.round(dps)}`)}
            ${row('Armure', `${Math.round(s.armor)} (−${Math.round((1 - 100 / (100 + s.armor)) * 100)} %)`)}
            ${row('Critique', `${(s.critChance * 100).toFixed(1)} % · ×${s.critMult.toFixed(2)}`)}
            ${row("Vitesse d'attaque", `${Math.round(s.attackSpeed * 100)} %`)}
            ${row('Déplacement', `${Math.round(s.moveSpeed * 100)} %`)}
            ${row('Dégâts des sorts', `+${Math.round(s.spellPct * 100)} %`)}
            ${row('Vie par coup', `${s.lifeOnHit.toFixed(1)}`)}
            ${row('Régén. vie / mana', `${s.hpRegen.toFixed(1)} / ${s.manaRegen.toFixed(1)}`)}
            ${row('Recharge', `−${Math.round(s.cdr * 100)} %`)}
          </div>
        </div>
        <div class="inv-right">
          <h2>Sac <small>${c.inventory.length}/${INVENTORY_SIZE}</small></h2>
          <div class="grid">${cells.join('')}</div>
          <div class="inv-foot">
            <span>💰 ${c.gold} or · 🧪 ${c.potions}/${MAX_POTIONS}</span>
            <button data-action="salvage-commons" ${c.inventory.some((i) => i.rarity === 'common') ? '' : 'disabled'}>Recycler les communs</button>
          </div>
          <p class="help-note">Clic : équiper · Clic droit : recycler · Clic sur un emplacement équipé : retirer. ▲ = meilleur que l'objet porté.</p>
        </div>
      </div>`;
  }

  private onScreenClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const g = this.game;
    const item = t.closest('[data-item]') as HTMLElement | null;
    if (item?.dataset.item) {
      if (e.shiftKey) this.salvageItem(item.dataset.item);
      else {
        equipFromInventory(g.character, item.dataset.item);
        g.player.refreshStats();
        g.audio.play('pickup');
        this.hideTooltip();
        this.renderInventory();
      }
      return;
    }
    const eq = t.closest('[data-equipped]') as HTMLElement | null;
    if (eq?.dataset.equipped) {
      if (unequip(g.character, eq.dataset.equipped as Slot)) {
        g.player.refreshStats();
        this.hideTooltip();
        this.renderInventory();
      } else g.audio.play('error');
      return;
    }
    const btn = t.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    g.audio.unlock();
    switch (btn.dataset.action) {
      case 'new':
        g.newGame();
        break;
      case 'continue':
        g.continueGame();
        break;
      case 'help':
        this.screen.querySelector('.help-box')?.classList.toggle('hidden');
        break;
      case 'resume':
        g.setState('playing');
        break;
      case 'inventory':
        g.setState('inventory');
        break;
      case 'retry':
        g.retryFloor();
        break;
      case 'quit':
        location.reload();
        break;
      case 'descend':
        g.nextFloor();
        break;
      case 'buy-potion': {
        const price = potionPrice(g.character);
        if (g.character.gold >= price && g.character.potions < MAX_POTIONS) {
          g.character.gold -= price;
          g.character.potions++;
          g.audio.play('gold');
        }
        this.renderHalt();
        break;
      }
      case 'salvage-junk': {
        const ids = g.character.inventory.filter((i) => i.rarity === 'common' || i.rarity === 'magic').map((i) => i.id);
        for (const id of ids) salvage(g.character, id);
        g.audio.play('gold');
        this.renderHalt();
        break;
      }
      case 'salvage-commons': {
        const ids = g.character.inventory.filter((i) => i.rarity === 'common').map((i) => i.id);
        for (const id of ids) salvage(g.character, id);
        g.audio.play('gold');
        this.renderInventory();
        break;
      }
      case 'halt-inventory':
        this.inventoryFromHalt = true;
        this.renderInventory();
        break;
      case 'back-halt':
        this.inventoryFromHalt = false;
        this.renderHalt();
        break;
    }
  }

  private salvageItem(id: string): void {
    const gold = salvage(this.game.character, id);
    if (gold > 0) {
      this.game.audio.play('gold');
      this.hideTooltip();
      this.renderInventory();
    }
  }

  onInventoryChanged(): void {
    if (this.game.state === 'inventory') this.renderInventory();
  }

  onFloorLoaded(): void {
    for (const b of this.bars.values()) b.remove();
    this.bars.clear();
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  // ---------------------------------------------------------------------------
  // Infobulles
  // ---------------------------------------------------------------------------

  private findItem(id: string, slot?: Slot): Item | null {
    const c = this.game.character;
    if (slot) return c.equipment[slot];
    return c.inventory.find((i) => i.id === id) ?? null;
  }

  private itemHtml(item: Item, title?: string): string {
    const stats = (o: Partial<Record<StatKey, number>>) =>
      Object.entries(o)
        .filter(([, v]) => v)
        .map(([k, v]) => `<div>${STAT_LABELS[k as StatKey](v!)}</div>`)
        .join('');
    return `
      ${title ? `<div class="tt-label">${title}</div>` : ''}
      <div class="tt-name r-${item.rarity}">${esc(item.name)}</div>
      <div class="tt-type">${RARITY_LABELS[item.rarity]} · ${SLOT_LABELS[item.slot]} · niv. ${item.ilvl}</div>
      <div class="tt-base">${stats(item.base)}</div>
      <div class="tt-affixes">${stats(item.affixes)}</div>
      <div class="tt-foot">Recyclage : ${salvageValue(item)} or</div>`;
  }

  private showItemTooltip(item: Item, anchor: HTMLElement, equipped: boolean): void {
    const eq = this.game.character.equipment[item.slot];
    let html = `<div class="tt-col">${this.itemHtml(item, equipped ? 'Équipé' : undefined)}</div>`;
    if (!equipped && eq) {
      const diff = diffStats(itemStats(item), itemStats(eq));
      html += `<div class="tt-col compare">${this.itemHtml(eq, 'Porté actuellement')}
        <div class="tt-diff">${diff}</div></div>`;
    }
    this.tooltip.innerHTML = html;
    this.positionTooltip(anchor);
  }

  private showSkillTooltip(id: SkillId, anchor: HTMLElement): void {
    const s = SKILLS.find((x) => x.id === id)!;
    const p = this.game.player;
    const unlocked = p.isUnlocked(id);
    this.tooltip.innerHTML = `<div class="tt-col">
      <div class="tt-name">${s.name} <kbd>${esc(this.game.input.label(s.key))}</kbd></div>
      <div class="tt-type">${s.mana ? `${s.mana} mana · ` : ''}recharge ${p.skillCooldown(id).toFixed(1)} s</div>
      <div class="tt-desc">${s.description}</div>
      ${unlocked ? '' : `<div class="tt-lock">Débloqué au niveau ${s.unlock}</div>`}
    </div>`;
    this.positionTooltip(anchor);
  }

  private positionTooltip(anchor: HTMLElement): void {
    const tt = this.tooltip;
    tt.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = tt.offsetWidth;
    const h = tt.offsetHeight;
    let x = r.right + 10;
    if (x + w > window.innerWidth - 8) x = r.left - w - 10;
    let y = r.top;
    if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
    tt.style.left = `${Math.max(8, x)}px`;
    tt.style.top = `${Math.max(8, y)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Retours visuels
  // ---------------------------------------------------------------------------

  floatText(pos: THREE.Vector3, text: string, kind: FloatKind): void {
    const el = this.floaterPool.pop() ?? document.createElement('div');
    el.className = `float f-${kind}`;
    el.textContent = text;
    this.floatLayer.appendChild(el);
    const life = kind === 'info' ? 1.8 : kind === 'crit' ? 1.0 : 0.85;
    this.floaters.push({ el, pos: pos.clone(), t: 0, life, dx: (Math.random() - 0.5) * 30 });
    if (this.floaters.length > 80) this.recycle(this.floaters.shift()!);
  }

  private recycle(f: Floater) {
    f.el.remove();
    this.floaterPool.push(f.el);
  }

  toast(html: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    this.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 3500);
    setTimeout(() => el.remove(), 4200);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild?.remove();
  }

  banner(title: string, sub = ''): void {
    (this.bannerEl.querySelector('.banner-title') as HTMLElement).textContent = title;
    (this.bannerEl.querySelector('.banner-sub') as HTMLElement).textContent = sub;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerTimer = 3;
  }

  hurtVignette(ratio: number): void {
    this.vignetteLevel = Math.min(1, this.vignetteLevel + 0.3 + ratio * 2);
  }

  toggleFps(): void {
    this.showFps = !this.showFps;
    this.fpsEl.classList.toggle('hidden', !this.showFps);
  }

  // ---------------------------------------------------------------------------
  // Mise à jour par frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const g = this.game;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.showFps) this.fpsEl.textContent = `${g.fps} fps · ${g.renderer.info.render.calls} draw calls`;

    // Textes flottants.
    for (const f of this.floaters) {
      f.t += dt;
      g.project(f.pos, this.proj);
      const k = f.t / f.life;
      const rise = 40 * k + (f.el.classList.contains('f-crit') ? 10 : 0);
      f.el.style.transform = `translate(${this.proj.x + f.dx * k}px, ${this.proj.y - rise}px) translate(-50%, -50%) scale(${f.el.classList.contains('f-crit') ? 1.3 - 0.3 * Math.min(1, k * 4) : 1})`;
      f.el.style.opacity = this.proj.visible ? String(Math.min(1, (1 - k) * 2.5)) : '0';
    }
    this.floaters = this.floaters.filter((f) => {
      if (f.t < f.life) return true;
      this.recycle(f);
      return false;
    });

    // Vignette de dégâts + alerte vie basse.
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.8);
    const hpRatio = g.player ? g.player.hp / g.player.stats.maxHp : 1;
    const low = g.state === 'playing' && hpRatio < 0.3 ? 0.35 + Math.sin(g.time * 6) * 0.15 : 0;
    this.vignette.style.opacity = String(Math.max(this.vignetteLevel, low));

    if (g.state === 'menu') return;
    this.updateHud(dt);
  }

  private updateHud(dt: number): void {
    const g = this.game;
    const p = g.player;
    const c = g.character;
    const s = p.stats;
    this.els.hpFill.style.height = `${(p.hp / s.maxHp) * 100}%`;
    this.els.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(s.maxHp)}`;
    this.els.manaFill.style.height = `${(p.mana / s.maxMana) * 100}%`;
    this.els.manaText.textContent = `${Math.floor(p.mana)} / ${Math.round(s.maxMana)}`;
    const need = xpToNext(c.level);
    this.els['xp-fill'].style.width = `${(c.xp / need) * 100}%`;
    this.els['xp-text'].textContent = `Niveau ${c.level} — ${c.xp} / ${need} XP`;
    this.els['floor-name'].innerHTML = `<b>Étage ${c.floor}</b> · ${esc(floorName(c.floor))}`;
    this.els.gold.textContent = `💰 ${c.gold}`;
    this.els.kills.textContent = `💀 ${c.kills}`;
    const remaining = g.enemies.filter((e) => !e.dead).length;
    this.els.objective.textContent = g.bossFloor && !g.portalActive
      ? '⚔ Terrassez le Roi-Liche pour ouvrir le portail'
      : `🌀 Trouvez le portail · ${remaining} monstre(s) restant(s)`;

    // Barre de compétences.
    for (const sk of SKILLS) {
      const el = this.skillEls.get(sk.id)!;
      const unlocked = p.isUnlocked(sk.id);
      const total = p.skillCooldown(sk.id);
      const left = p.cd[sk.id];
      const frac = total > 0 ? Math.min(1, left / total) : 0;
      el.cd.style.background = frac > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${frac * 360}deg, transparent 0)` : 'none';
      el.lock.style.display = unlocked ? 'none' : 'flex';
      const noMana = p.mana < sk.mana;
      el.root.classList.toggle('nomana', unlocked && noMana);
      (el.root.querySelector('.skill-key') as HTMLElement).textContent = g.input.label(sk.key);
      if (sk.id === 'potion') (el.root.querySelector('.skill-count') as HTMLElement).textContent = String(c.potions);
    }

    // Cible survolée / boss.
    const boss = g.enemies.find((e) => e.isBoss && !e.dead && e.aggro);
    this.els.boss.classList.toggle('hidden', !boss);
    if (boss) {
      this.els['boss-name'].textContent = boss.name;
      this.els['boss-fill'].style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      this.els['boss-hp'].textContent = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
    }
    const target = g.hovered && !g.hovered.isBoss ? g.hovered : null;
    this.els.target.classList.toggle('hidden', !target);
    if (target) {
      this.els['target-name'].innerHTML = `<span class="${target.elite ? 'elite' : ''}">${esc(target.name)}</span>`;
      this.els['target-fill'].style.width = `${(target.hp / target.maxHp) * 100}%`;
    }

    this.updateEnemyBars();
    this.updateItemLabels();
    this.updateHint(dt);
    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      this.drawMinimap();
    }
  }

  /** Noms des objets au sol (couleur de rareté), façon Diablo. */
  private updateItemLabels(): void {
    const g = this.game;
    const seen = new Set<string>();
    for (const k of g.pickups) {
      if (k.kind !== 'item' || !k.item || k.taken) continue;
      g.project(k.pos.clone().setY(1.1), this.proj);
      if (!this.proj.visible) continue;
      seen.add(k.item.id);
      let el = this.labels.get(k.item.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `ground-label r-${k.item.rarity}`;
        el.textContent = k.item.name;
        this.barLayer.appendChild(el);
        this.labels.set(k.item.id, el);
      }
      el.style.transform = `translate(${this.proj.x}px, ${this.proj.y}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.labels) {
      if (!seen.has(id)) {
        el.remove();
        this.labels.delete(id);
      }
    }
  }

  /** Aide contextuelle pour les premières minutes. */
  private updateHint(dt: number): void {
    const g = this.game;
    const el = this.els['hint-row'];
    this.hintTimer += dt;
    let hint = '';
    const L = (c: string) => `<kbd>${esc(g.input.label(c))}</kbd>`;
    if (g.character.floor === 1 && g.character.level === 1 && this.hintTimer < 40) {
      hint = `${L('KeyW')}${L('KeyA')}${L('KeyS')}${L('KeyD')} se déplacer · <kbd>Clic gauche</kbd> frapper · <kbd>Clic droit</kbd> boule de feu · ${L('Space')} roulade · ${L('KeyF')} potion`;
    } else if (g.character.inventory.length >= 20 && g.character.inventory.length < 24) {
      hint = `Sac presque plein — ${L('KeyI')} pour équiper ou recycler (clic droit)`;
    } else if (g.player.hp / g.player.stats.maxHp < 0.3 && g.character.potions > 0) {
      hint = `Vie basse ! ${L('KeyF')} pour boire une potion`;
    }
    if (el.dataset.hint !== hint) {
      el.dataset.hint = hint;
      el.innerHTML = hint;
      el.classList.toggle('hidden', !hint);
    }
  }

  /** Petites barres de vie au-dessus des ennemis blessés ou élites. */
  private updateEnemyBars(): void {
    const g = this.game;
    const seen = new Set<number>();
    for (const e of g.enemies) {
      if (e.dead || e.isBoss) continue;
      const recent = g.time - e.lastHitAt < 4;
      if (!recent && !(e.elite && e.aggro)) continue;
      const pos = e.pos.clone().setY(e.rig.height * (e.elite ? 1.2 : 1.1) + 0.3);
      g.project(pos, this.proj);
      if (!this.proj.visible) continue;
      seen.add(e.id);
      let bar = this.bars.get(e.id);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = `ebar${e.elite ? ' elite' : ''}`;
        bar.innerHTML = '<div></div>';
        this.barLayer.appendChild(bar);
        this.bars.set(e.id, bar);
      }
      bar.style.transform = `translate(${this.proj.x}px, ${this.proj.y}px) translate(-50%, -50%)`;
      (bar.firstElementChild as HTMLElement).style.width = `${(e.hp / e.maxHp) * 100}%`;
    }
    for (const [id, bar] of this.bars) {
      if (!seen.has(id)) {
        bar.remove();
        this.bars.delete(id);
      }
    }
  }

  private drawMinimap(): void {
    const g = this.game;
    const d = g.dungeon;
    const ctx = this.mmCtx;
    const W = this.minimap.width;
    const scale = 3.2;
    const p = g.player.pos;
    const px = p.x / TILE;
    const py = p.z / TILE;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,6,5,0.7)';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2 - px * scale, W / 2 - py * scale);
    ctx.fillStyle = 'rgba(176,160,132,0.55)';
    const r = Math.ceil(W / scale / 2) + 2;
    for (let y = Math.floor(py - r); y < py + r; y++)
      for (let x = Math.floor(px - r); x < px + r; x++) {
        if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
        const i = y * d.w + x;
        if (g.explored[i] && d.tiles[i] === FLOOR) ctx.fillRect(x * scale, y * scale, scale + 0.3, scale + 0.3);
      }
    // Portail.
    if (g.world) {
      const ex = g.world.portalPosition.x / TILE;
      const ey = g.world.portalPosition.z / TILE;
      const ti = Math.floor(ey) * d.w + Math.floor(ex);
      if (g.explored[ti]) {
        ctx.fillStyle = g.portalActive ? '#7fb0ff' : '#6a5a7a';
        ctx.beginPath();
        ctx.arc(ex * scale, ey * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Ennemis proches.
    for (const e of g.enemies) {
      if (e.dead) continue;
      const ex = e.pos.x / TILE;
      const ey = e.pos.z / TILE;
      if (!g.explored[Math.floor(ey) * d.w + Math.floor(ex)]) continue;
      ctx.fillStyle = e.isBoss ? '#c07aff' : e.elite ? '#6f8cff' : '#d0412f';
      ctx.fillRect(ex * scale - 1.5, ey * scale - 1.5, e.isBoss ? 5 : 3, e.isBoss ? 5 : 3);
    }
    ctx.restore();
    // Joueur (flèche).
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-g.player.facing + Math.PI);
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(176,140,80,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function diffStats(a: Partial<Record<StatKey, number>>, b: Partial<Record<StatKey, number>>): string {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as StatKey[]);
  const rows: string[] = [];
  for (const k of keys) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (Math.abs(d) < 1e-6) continue;
    const label = STAT_LABELS[k](Math.abs(d)).replace(/^[+-]/, '');
    rows.push(`<div class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${label}</div>`);
  }
  return rows.length ? `<div class="tt-label">Si vous équipez :</div>${rows.join('')}` : '';
}
