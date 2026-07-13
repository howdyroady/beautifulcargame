import type { ParkingScenario } from '../game/parkingMode';
import { TRACKS } from '../track/circuit';

export type GameMode = 'race' | 'derby' | 'parking';

export interface CarChoice {
  id: string;
  label: string;
  color: number;
  /** Optional real glTF model (CC0) loaded instead of the procedural coupe. */
  modelUrl?: string;
}

export const CAR_CHOICES: CarChoice[] = [
  { id: 'silver', label: 'SILBER', color: 0x9199a1 },
  { id: 'c63', label: 'SCHWARZ', color: 0x1a1c20 },
  { id: 'gt', label: '3D-MODELL', color: 0xf0f0f0, modelUrl: 'models/toycar.glb' },
];

export interface MenuSelection {
  mode: GameMode;
  vsBot: boolean;
  carColor: number;
  carModelUrl?: string;
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
  /** Fires when the player taps a different car chip — drives the 3D showroom preview. */
  onCarChange?: (choice: CarChoice) => void;
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
      <button class="menu-btn menu-btn-ghost" data-action="extra-toggle">Auto &amp; Strecke ▾</button>
      <div class="menu-extra" data-extra style="display:none">
        <div class="mode-toggle" data-group="car">
          ${CAR_CHOICES.map((c, i) => `<button class="mode-btn ${i === 0 ? 'active' : ''}" data-val="${c.id}">${c.label}</button>`).join('')}
        </div>
        <div class="mode-toggle" data-group="track" data-race-only>
          ${Object.values(TRACKS).map((t, i) => `<button class="mode-btn ${i === 0 ? 'active' : ''}" data-val="${t.id}">${t.name}</button>`).join('')}
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
      </div>
      <div class="menu-buttons">
        <button class="menu-btn" data-action="local">START</button>
        <button class="menu-btn menu-btn-ghost" data-action="online-toggle" data-race-derby-only>Online mit Freund ▾</button>
        <div class="menu-online" data-online-panel style="display:none">
          <button class="menu-btn menu-btn-small" data-action="host">Spiel erstellen</button>
          <div class="menu-join-row">
            <input class="menu-input" data-join-code placeholder="CODE" maxlength="6" />
            <button class="menu-btn menu-btn-small" data-action="join">Beitreten</button>
          </div>
        </div>
      </div>
      <p class="menu-sub small">Steuerung: WASD + Shift (Bremse) + Space (Nitro) · Pfeiltasten auf dem Handy</p>
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
      const choice = CAR_CHOICES.find((c) => c.id === v)!;
      this.sel.carColor = choice.color;
      this.sel.carModelUrl = choice.modelUrl;
      this.onCarChange?.(choice);
    });
    bindGroup('track', (v) => (this.sel.trackId = v));
    bindGroup('opponent', (v) => (this.sel.vsBot = v === 'bot'));
    bindGroup('scenario', (v) => (this.sel.scenario = v as ParkingScenario));

    const onlinePanel = this.root.querySelector('[data-online-panel]') as HTMLElement;
    const onlineToggle = this.root.querySelector('[data-action="online-toggle"]') as HTMLButtonElement;
    onlineToggle.addEventListener('click', () => {
      const open = onlinePanel.style.display === 'none';
      onlinePanel.style.display = open ? 'flex' : 'none';
      onlineToggle.textContent = open ? 'Online mit Freund ▴' : 'Online mit Freund ▾';
    });

    // Car/track/opponent options are collapsed by default so the menu opens clean.
    const extraPanel = this.root.querySelector('[data-extra]') as HTMLElement;
    const extraToggle = this.root.querySelector('[data-action="extra-toggle"]') as HTMLButtonElement;
    extraToggle.addEventListener('click', () => {
      const open = extraPanel.style.display === 'none';
      extraPanel.style.display = open ? 'flex' : 'none';
      extraToggle.textContent = open ? 'Auto & Strecke ▴' : 'Auto & Strecke ▾';
    });

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
    // The online panel is opened only via its toggle — keep it collapsed here so
    // it never inherits the generic race/derby visibility above, and so switching
    // modes always closes it.
    const panel = this.root.querySelector('[data-online-panel]') as HTMLElement | null;
    const toggle = this.root.querySelector('[data-action="online-toggle"]') as HTMLButtonElement | null;
    if (panel) panel.style.display = 'none';
    if (toggle) toggle.textContent = 'Online mit Freund ▾';
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
