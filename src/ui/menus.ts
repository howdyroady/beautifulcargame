import type { ParkingScenario } from '../game/parkingMode';

export type GameMode = 'race' | 'derby' | 'parking';

export interface CarChoice {
  id: string;
  label: string;
  color: number;
}

export const CAR_CHOICES: CarChoice[] = [
  { id: 'silver', label: 'C-COUPE SILBER', color: 0x9199a1 },
  { id: 'c63', label: 'C63 AMG SCHWARZ', color: 0x1a1c20 },
  { id: 'red', label: 'ROT', color: 0xa02828 },
];

export interface MenuSelection {
  mode: GameMode;
  vsBot: boolean;
  carColor: number;
  trackId: string;
  scenario: ParkingScenario;
}

export interface MainMenuCallbacks {
  onLocal: (sel: MenuSelection) => void;
  onHost: (sel: MenuSelection) => void;
  onJoin: (code: string, sel: MenuSelection) => void;
}

export class MainMenu {
  root: HTMLDivElement;
  private sel: MenuSelection = { mode: 'race', vsBot: true, carColor: CAR_CHOICES[0].color, trackId: 'city', scenario: 'vorwaerts' };

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <h1 class="menu-title">ROADRAGE<span>GP</span></h1>
      <div class="mode-toggle" data-group="mode">
        <button class="mode-btn active" data-val="race">RENNEN</button>
        <button class="mode-btn" data-val="derby">DERBY</button>
        <button class="mode-btn" data-val="parking">PARKEN</button>
      </div>
      <div class="mode-toggle" data-group="car">
        ${CAR_CHOICES.map((c, i) => `<button class="mode-btn ${i === 0 ? 'active' : ''}" data-val="${c.id}">${c.label}</button>`).join('')}
      </div>
      <div class="mode-toggle" data-group="track" data-race-only>
        <button class="mode-btn active" data-val="city">CITY GP</button>
        <button class="mode-btn" data-val="ring">RING</button>
      </div>
      <div class="mode-toggle" data-group="opponent" data-race-derby-only>
        <button class="mode-btn active" data-val="bot">GEGEN BOTS</button>
        <button class="mode-btn" data-val="player">2 SPIELER</button>
      </div>
      <div class="mode-toggle" data-group="scenario" data-parking-only style="display:none">
        <button class="mode-btn active" data-val="vorwaerts">VORWÄRTS</button>
        <button class="mode-btn" data-val="rueckwaerts">RÜCKWÄRTS</button>
        <button class="mode-btn" data-val="seitwaerts">SEITWÄRTS</button>
      </div>
      <div class="menu-buttons">
        <button class="menu-btn" data-action="local">START</button>
        <button class="menu-btn" data-action="host" data-race-derby-only>Online: Spiel erstellen</button>
        <div class="menu-join-row" data-race-derby-only>
          <input class="menu-input" data-join-code placeholder="CODE" maxlength="6" />
          <button class="menu-btn menu-btn-small" data-action="join">Beitreten</button>
        </div>
      </div>
      <p class="menu-sub small">Steuerung: WASD + Shift (Bremse) + Space (Nitro) · Touch-Joystick auf dem Handy</p>
    `;
    container.appendChild(this.root);

    // Generic chip-group behavior.
    const bindGroup = (group: string, apply: (val: string) => void) => {
      const btns = Array.from(this.root.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] [data-val]`));
      btns.forEach((btn) => {
        btn.addEventListener('click', () => {
          apply(btn.dataset.val!);
          btns.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
    };
    bindGroup('mode', (v) => {
      this.sel.mode = v as GameMode;
      this.updateVisibility();
    });
    bindGroup('car', (v) => {
      this.sel.carColor = CAR_CHOICES.find((c) => c.id === v)!.color;
    });
    bindGroup('track', (v) => (this.sel.trackId = v));
    bindGroup('opponent', (v) => (this.sel.vsBot = v === 'bot'));
    bindGroup('scenario', (v) => (this.sel.scenario = v as ParkingScenario));

    this.root.querySelector('[data-action="local"]')!.addEventListener('click', () => callbacks.onLocal({ ...this.sel }));
    this.root.querySelector('[data-action="host"]')!.addEventListener('click', () => callbacks.onHost({ ...this.sel }));
    this.root.querySelector('[data-action="join"]')!.addEventListener('click', () => {
      const input = this.root.querySelector('[data-join-code]') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code) callbacks.onJoin(code, { ...this.sel });
    });

    this.updateVisibility();
  }

  private updateVisibility() {
    const mode = this.sel.mode;
    this.root.querySelectorAll<HTMLElement>('[data-race-only]').forEach((el) => {
      el.style.display = mode === 'race' ? '' : 'none';
    });
    this.root.querySelectorAll<HTMLElement>('[data-race-derby-only]').forEach((el) => {
      el.style.display = mode === 'parking' ? 'none' : '';
    });
    this.root.querySelectorAll<HTMLElement>('[data-parking-only]').forEach((el) => {
      el.style.display = mode === 'parking' ? '' : 'none';
    });
  }

  destroy() {
    this.root.remove();
  }
}

export class LobbyScreen {
  root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private codeEl: HTMLDivElement;

  constructor(container: HTMLElement, onCancel: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'menu lobby';
    this.root.innerHTML = `
      <h2 class="menu-title small">LOBBY</h2>
      <div class="lobby-code" data-code></div>
      <div class="lobby-status" data-status>Verbindung wird aufgebaut...</div>
      <button class="menu-btn menu-btn-small" data-cancel>Abbrechen</button>
    `;
    container.appendChild(this.root);
    this.codeEl = this.root.querySelector('[data-code]') as HTMLDivElement;
    this.statusEl = this.root.querySelector('[data-status]') as HTMLDivElement;
    this.root.querySelector('[data-cancel]')!.addEventListener('click', onCancel);
  }

  setCode(code: string) {
    this.codeEl.textContent = code;
    this.codeEl.style.display = 'block';
  }

  setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  destroy() {
    this.root.remove();
  }
}
