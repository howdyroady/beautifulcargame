import type { MatchPhase } from '../game/matchState';
import { SpeedGauge } from './speedGauge';
import { PauseOverlay } from './pauseOverlay';

export class Hud {
  root: HTMLDivElement;
  private hpBars: [HTMLDivElement, HTMLDivElement];
  private scoreEls: [HTMLDivElement, HTMLDivElement];
  private center: HTMLDivElement;
  private names: [string, string];
  private speedGauge: SpeedGauge;
  private pause: PauseOverlay | null = null;

  /** True while the pause overlay is open (only when pause callbacks were given). */
  get paused() {
    return this.pause?.paused ?? false;
  }

  constructor(
    container: HTMLElement,
    names: [string, string] = ['SPIELER 1', 'SPIELER 2'],
    pauseCallbacks?: { onRestart: () => void; onMenu: () => void },
  ) {
    this.names = names;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        ${pauseCallbacks ? '<button class="hud-pause" data-pause aria-label="Pause">II</button>' : ''}
        <div class="hud-player left">
          <div class="hud-name">${names[0]}</div>
          <div class="hud-hpbar"><div class="hud-hpfill" data-side="left"></div></div>
          <div class="hud-score" data-score="left">0</div>
        </div>
        <div class="hud-center" data-center></div>
        <div class="hud-player right">
          <div class="hud-name">${names[1]}</div>
          <div class="hud-hpbar"><div class="hud-hpfill" data-side="right"></div></div>
          <div class="hud-score" data-score="right">0</div>
        </div>
      </div>
    `;
    container.appendChild(this.root);
    if (pauseCallbacks) {
      this.pause = new PauseOverlay(this.root, this.root.querySelector('[data-pause]') as HTMLElement, pauseCallbacks);
    }
    this.hpBars = [
      this.root.querySelector('[data-side="left"]') as HTMLDivElement,
      this.root.querySelector('[data-side="right"]') as HTMLDivElement,
    ];
    this.scoreEls = [
      this.root.querySelector('[data-score="left"]') as HTMLDivElement,
      this.root.querySelector('[data-score="right"]') as HTMLDivElement,
    ];
    this.center = this.root.querySelector('[data-center]') as HTMLDivElement;
    this.speedGauge = new SpeedGauge(container);
  }

  setSpeed(kmh: number) {
    this.speedGauge.setSpeed(kmh);
  }

  setHp(hp: [number, number], maxHp: number) {
    hp.forEach((v, i) => {
      const pct = Math.max(0, Math.min(100, (v / maxHp) * 100));
      this.hpBars[i].style.width = `${pct}%`;
      this.hpBars[i].classList.toggle('low', pct < 30);
    });
  }

  setScore(score: [number, number]) {
    this.scoreEls[0].textContent = String(score[0]);
    this.scoreEls[1].textContent = String(score[1]);
  }

  setPhase(phase: MatchPhase, data?: { winner?: number; countdown?: number }) {
    if (phase === 'countdown') {
      const n = Math.ceil(data?.countdown ?? 0);
      this.center.textContent = n > 0 ? String(n) : 'LOS!';
      this.center.className = 'hud-center-text countdown';
    } else if (phase === 'roundEnd') {
      const winner = data?.winner;
      this.center.textContent = winner === undefined ? 'UNENTSCHIEDEN' : `${this.names[winner]} GEWINNT DIE RUNDE`;
      this.center.className = 'hud-center-text round-end';
    } else if (phase === 'matchEnd') {
      this.center.textContent = `${this.names[data?.winner ?? 0]} GEWINNT DAS MATCH!`;
      this.center.className = 'hud-center-text match-end';
    } else {
      this.center.textContent = '';
      this.center.className = 'hud-center-text';
    }
  }

  destroy() {
    this.root.remove();
    this.speedGauge.destroy();
  }
}
