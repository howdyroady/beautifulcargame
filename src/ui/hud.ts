import type { MatchPhase } from '../game/matchState';

export class Hud {
  root: HTMLDivElement;
  private hpBars: [HTMLDivElement, HTMLDivElement];
  private scoreEls: [HTMLDivElement, HTMLDivElement];
  private center: HTMLDivElement;
  private names: [string, string];

  constructor(container: HTMLElement, names: [string, string] = ['SPIELER 1', 'SPIELER 2']) {
    this.names = names;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
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
    this.hpBars = [
      this.root.querySelector('[data-side="left"]') as HTMLDivElement,
      this.root.querySelector('[data-side="right"]') as HTMLDivElement,
    ];
    this.scoreEls = [
      this.root.querySelector('[data-score="left"]') as HTMLDivElement,
      this.root.querySelector('[data-score="right"]') as HTMLDivElement,
    ];
    this.center = this.root.querySelector('[data-center]') as HTMLDivElement;
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
  }
}
