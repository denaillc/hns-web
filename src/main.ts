import './style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

function fail(msg: string) {
  ui.innerHTML = `<div class="screen modal"><div class="panel small"><h2>Impossible de lancer le jeu</h2><p>${msg}</p></div></div>`;
}

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2')) {
  fail("Votre navigateur ne supporte pas WebGL 2. Essayez une version récente de Chrome, Firefox, Edge ou Safari, et vérifiez que l'accélération matérielle est activée.");
} else {
  try {
    const game = new Game(canvas, ui);
    // Accès pour le débogage et les tests de bout en bout.
    (window as unknown as { __game: Game }).__game = game;
  } catch (e) {
    console.error(e);
    fail(String(e));
  }
}
