/**
 * Entrées clavier/souris. On utilise `KeyboardEvent.code` (position physique)
 * pour que ZQSD (AZERTY) et WASD (QWERTY) marchent sans réglage.
 */
export class Input {
  readonly keys = new Set<string>();
  /** Touches pressées depuis la dernière frame (front montant). */
  readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseLeft = false;
  mouseRight = false;
  wheel = 0;
  /** Libellés réels des touches selon la disposition du clavier. */
  layout = new Map<string, string>();
  private enabled = true;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (e.button === 0) {
        this.mouseLeft = true;
        this.pressed.add('Mouse0');
      }
      if (e.button === 2) {
        this.mouseRight = true;
        this.pressed.add('Mouse2');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    void this.loadLayout();
  }

  private async loadLayout() {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (!kb?.getLayoutMap) return;
    try {
      const map = await kb.getLayoutMap();
      map.forEach((v, k) => this.layout.set(k, v.toUpperCase()));
    } catch {
      /* non supporté (Firefox, Safari) */
    }
  }

  /** Libellé affichable d'une touche physique (ex. KeyW → « Z » en AZERTY). */
  label(code: string): string {
    if (code === 'Mouse0') return 'Clic G';
    if (code === 'Mouse2') return 'Clic D';
    if (code === 'Space') return 'Espace';
    if (code.startsWith('Digit')) return code.slice(5);
    return this.layout.get(code) ?? code.replace(/^Key/, '');
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** À appeler en fin de frame. */
  endFrame(): void {
    this.pressed.clear();
    this.wheel = 0;
  }

  reset(): void {
    this.keys.clear();
    this.pressed.clear();
    this.mouseLeft = this.mouseRight = false;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) {
      this.mouseLeft = this.mouseRight = false;
    }
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
