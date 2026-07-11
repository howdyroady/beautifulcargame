/**
 * Shared in-game pause overlay. Given a HUD root and an existing pause button,
 * it appends a "PAUSE" overlay (Weiter / Neustart / Hauptmenü) and toggles a
 * `paused` flag the game loop reads to freeze the sim. Used by derby & parking;
 * the race HUD has its own inline copy of the same markup.
 */
export class PauseOverlay {
  paused = false;
  private overlay: HTMLDivElement;

  constructor(
    root: HTMLElement,
    button: HTMLElement,
    callbacks: { onRestart: () => void; onMenu: () => void; restartLabel?: string },
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <h2>PAUSE</h2>
      <div class="results-buttons">
        <button class="menu-btn menu-btn-small" data-resume>Weiter</button>
        <button class="menu-btn menu-btn-small" data-restart>${callbacks.restartLabel ?? 'Neustart'}</button>
        <button class="menu-btn menu-btn-small" data-menu>Hauptmenü</button>
      </div>`;
    root.appendChild(this.overlay);

    button.style.pointerEvents = 'auto';
    button.addEventListener('click', () => this.set(true));
    const q = (s: string) => this.overlay.querySelector(s) as HTMLButtonElement;
    q('[data-resume]').addEventListener('click', () => this.set(false));
    q('[data-restart]').addEventListener('click', callbacks.onRestart);
    q('[data-menu]').addEventListener('click', callbacks.onMenu);
  }

  set(p: boolean) {
    this.paused = p;
    this.overlay.style.display = p ? 'flex' : 'none';
    this.overlay.style.pointerEvents = p ? 'auto' : 'none';
  }
}
