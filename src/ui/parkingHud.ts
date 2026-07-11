import { PauseOverlay } from './pauseOverlay';

/** HUD for the parking mode: hint text, damage hearts, timer, and success/fail overlays. */
export class ParkingHud {
  root: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private hitsEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private overlay: HTMLDivElement;
  private pause: PauseOverlay;

  /** True while the pause overlay is open — the parking loop freezes on this. */
  get paused() {
    return this.pause.paused;
  }

  constructor(container: HTMLElement, callbacks: { onRetry: () => void; onMenu: () => void }) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="arcade-top">
        <div class="arcade-topleft">
          <button class="hud-pause" data-pause aria-label="Pause">II</button>
          <div class="parking-hits" data-hits>❤❤❤</div>
        </div>
        <div class="parking-hint" data-hint></div>
        <div class="arcade-time" data-time>0:00</div>
      </div>
      <div class="race-results" data-overlay style="display:none">
        <h2 data-overlay-title></h2>
        <div class="results-buttons">
          <button class="menu-btn menu-btn-small" data-retry>Nochmal</button>
          <button class="menu-btn menu-btn-small" data-tomenu>Menü</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);
    this.hintEl = this.root.querySelector('[data-hint]') as HTMLDivElement;
    this.hitsEl = this.root.querySelector('[data-hits]') as HTMLDivElement;
    this.timeEl = this.root.querySelector('[data-time]') as HTMLDivElement;
    this.overlay = this.root.querySelector('[data-overlay]') as HTMLDivElement;

    const bind = (sel: string, fn: () => void) => {
      const el = this.root.querySelector(sel) as HTMLButtonElement;
      el.style.pointerEvents = 'auto';
      el.addEventListener('click', fn);
    };
    bind('[data-retry]', callbacks.onRetry);
    bind('[data-tomenu]', callbacks.onMenu);

    this.pause = new PauseOverlay(this.root, this.root.querySelector('[data-pause]') as HTMLElement, {
      onRestart: callbacks.onRetry,
      onMenu: callbacks.onMenu,
    });
  }

  setHud(h: { hits: number; maxHits: number; time: number; hint: string }) {
    this.hintEl.textContent = h.hint;
    this.hitsEl.textContent = '❤'.repeat(Math.max(0, h.maxHits - h.hits)) + '🖤'.repeat(h.hits);
    const m = Math.floor(h.time / 60);
    const s = Math.floor(h.time % 60);
    this.timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  showResult(success: boolean, time: number) {
    const title = this.overlay.querySelector('[data-overlay-title]') as HTMLElement;
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    title.textContent = success ? `GEPARKT! ${m}:${String(s).padStart(2, '0')} 🏆` : 'ZU VIELE TREFFER 💥';
    this.overlay.style.display = 'flex';
    this.overlay.style.pointerEvents = 'auto';
  }

  destroy() {
    this.root.remove();
  }
}
