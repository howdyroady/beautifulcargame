import type { RacePhase } from '../game/raceState';
import { SpeedGauge } from './speedGauge';

const TOTAL_LAPS = 3;

export class RaceHud {
  root: HTMLDivElement;
  private lapEls: [HTMLDivElement, HTMLDivElement];
  private placeEls: [HTMLDivElement, HTMLDivElement];
  private center: HTMLDivElement;
  private names: [string, string];
  private speedGauge: SpeedGauge;

  constructor(container: HTMLElement, names: [string, string] = ['SPIELER 1', 'SPIELER 2']) {
    this.names = names;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-player left">
          <div class="hud-name">${names[0]}</div>
          <div class="race-place" data-place="left">1.</div>
          <div class="race-laps" data-laps="left">Runde 0/${TOTAL_LAPS}</div>
        </div>
        <div class="hud-center" data-center></div>
        <div class="hud-player right">
          <div class="hud-name">${names[1]}</div>
          <div class="race-place" data-place="right">2.</div>
          <div class="race-laps" data-laps="right">Runde 0/${TOTAL_LAPS}</div>
        </div>
      </div>
    `;
    container.appendChild(this.root);
    this.lapEls = [
      this.root.querySelector('[data-laps="left"]') as HTMLDivElement,
      this.root.querySelector('[data-laps="right"]') as HTMLDivElement,
    ];
    this.placeEls = [
      this.root.querySelector('[data-place="left"]') as HTMLDivElement,
      this.root.querySelector('[data-place="right"]') as HTMLDivElement,
    ];
    this.center = this.root.querySelector('[data-center]') as HTMLDivElement;
    this.speedGauge = new SpeedGauge(container);
  }

  setSpeed(kmh: number) {
    this.speedGauge.setSpeed(kmh);
  }

  setProgress(laps: [number, number], places: [number, number]) {
    laps.forEach((l, i) => {
      this.lapEls[i].textContent = `Runde ${Math.min(l, TOTAL_LAPS)}/${TOTAL_LAPS}`;
    });
    places.forEach((p, i) => {
      this.placeEls[i].textContent = `${p}.`;
      this.placeEls[i].classList.toggle('leader', p === 1);
    });
  }

  setPhase(phase: RacePhase, data?: { winner?: number; countdown?: number }) {
    if (phase === 'countdown') {
      const n = Math.ceil(data?.countdown ?? 0);
      this.center.textContent = n > 0 ? String(n) : 'LOS!';
      this.center.className = 'hud-center-text countdown';
    } else if (phase === 'finished') {
      this.center.textContent = `${this.names[data?.winner ?? 0]} GEWINNT DAS RENNEN!`;
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
