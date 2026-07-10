import type { StandingEntry } from '../game/arcadeRace';

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const tenth = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenth}`;
}

/** Full race HUD: position, lap, timer, speed, nitro, drift combo, results overlay. */
export class ArcadeHud {
  root: HTMLDivElement;
  private posEl: HTMLDivElement;
  private lapEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private nitroFill: HTMLDivElement;
  private center: HTMLDivElement;
  private resultsEl: HTMLDivElement;
  private driftCombo: HTMLDivElement;
  private driftTimer = 0;

  constructor(container: HTMLElement, callbacks: { onRestart: () => void; onMenu: () => void }) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="arcade-top">
        <div class="arcade-pos" data-pos>-</div>
        <div class="hud-center" data-center></div>
        <div class="arcade-right">
          <div class="arcade-lap" data-lap>RUNDE 1/3</div>
          <div class="arcade-time" data-time>0:00.0</div>
        </div>
      </div>
      <div class="drift-combo" data-drift></div>
      <div class="arcade-bottom">
        <div class="arcade-speed"><span data-speed>0</span><small>km/h</small></div>
        <div class="nitro-bar"><div class="nitro-fill" data-nitro></div><span class="nitro-label">NITRO</span></div>
      </div>
      <div class="race-results" data-results style="display:none">
        <h2>ERGEBNIS</h2>
        <ol data-results-list></ol>
        <div class="results-buttons">
          <button class="menu-btn menu-btn-small" data-restart>Nochmal</button>
          <button class="menu-btn menu-btn-small" data-tomenu>Menü</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);
    this.posEl = this.root.querySelector('[data-pos]') as HTMLDivElement;
    this.lapEl = this.root.querySelector('[data-lap]') as HTMLDivElement;
    this.timeEl = this.root.querySelector('[data-time]') as HTMLDivElement;
    this.speedEl = this.root.querySelector('[data-speed]') as HTMLDivElement;
    this.nitroFill = this.root.querySelector('[data-nitro]') as HTMLDivElement;
    this.center = this.root.querySelector('[data-center]') as HTMLDivElement;
    this.resultsEl = this.root.querySelector('[data-results]') as HTMLDivElement;
    this.driftCombo = this.root.querySelector('[data-drift]') as HTMLDivElement;

    const btnStyle = (sel: string, fn: () => void) => {
      const el = this.root.querySelector(sel) as HTMLButtonElement;
      el.style.pointerEvents = 'auto';
      el.addEventListener('click', fn);
    };
    btnStyle('[data-restart]', callbacks.onRestart);
    btnStyle('[data-tomenu]', callbacks.onMenu);
  }

  setHud(h: { speed: number; nitro: number; lap: number; totalLaps: number; position: number; carCount: number; time: number }) {
    this.posEl.textContent = `${h.position}.`;
    this.posEl.classList.toggle('leader', h.position === 1);
    this.lapEl.textContent = `RUNDE ${h.lap}/${h.totalLaps}`;
    this.timeEl.textContent = formatTime(h.time);
    this.speedEl.textContent = String(Math.round(Math.max(0, h.speed)));
    this.nitroFill.style.width = `${Math.round(h.nitro * 100)}%`;
    this.nitroFill.classList.toggle('full', h.nitro > 0.95);
  }

  /** Show drift combo indicator. Call every frame with drift state. */
  setDrift(isDrifting: boolean, comboMultiplier: number, nitroEarned: number) {
    if (isDrifting && comboMultiplier > 1.0) {
      this.driftCombo.textContent = `🔥 DRIFT ×${comboMultiplier.toFixed(1)}  +${Math.round(nitroEarned * 100)}%`;
      this.driftCombo.classList.add('active');
      this.driftTimer = 1.5;
    } else {
      this.driftTimer -= 1 / 60;
      if (this.driftTimer <= 0) {
        this.driftCombo.classList.remove('active');
      }
    }
  }

  setCountdown(remaining: number) {
    const n = Math.ceil(remaining);
    if (n > 0) {
      this.center.textContent = String(n);
      this.center.className = 'hud-center-text countdown pulse';
    } else {
      this.center.textContent = 'LOS!';
      this.center.className = 'hud-center-text countdown go-flash';
      setTimeout(() => (this.center.textContent = ''), 800);
    }
  }

  showResults(standings: StandingEntry[]) {
    const list = this.resultsEl.querySelector('[data-results-list]') as HTMLOListElement;
    list.innerHTML = standings
      .map((s) => `<li class="${s.name === 'DU' ? 'me' : ''}">${s.name} ${s.finished ? '· ' + formatTime(s.finishTime) : '· DNF'}</li>`)
      .join('');
    this.resultsEl.style.display = 'flex';
    this.resultsEl.style.pointerEvents = 'auto';
  }

  destroy() {
    this.root.remove();
  }
}
