export type GameMode = 'derby' | 'race';

export interface MainMenuCallbacks {
  onLocal: (mode: GameMode, vsBot: boolean) => void;
  onHost: (mode: GameMode) => void;
  onJoin: (code: string, mode: GameMode) => void;
}

export class MainMenu {
  root: HTMLDivElement;
  private mode: GameMode = 'derby';
  private vsBot = false;

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <h1 class="menu-title">ROADRAGE<span>DERBY</span></h1>
      <p class="menu-sub">Derby: Ramm deinen Gegner von der schrumpfenden Plattform. Rennen: 3 Runden, wer zuerst durchs Ziel ist gewinnt.</p>
      <div class="mode-toggle">
        <button class="mode-btn active" data-mode="derby">DERBY</button>
        <button class="mode-btn" data-mode="race">RENNEN</button>
      </div>
      <div class="mode-toggle">
        <button class="mode-btn active" data-opponent="player">2 SPIELER</button>
        <button class="mode-btn" data-opponent="bot">GEGEN BOT</button>
      </div>
      <div class="menu-buttons">
        <button class="menu-btn" data-action="local">Lokal · WASD (+ Touch)</button>
        <button class="menu-btn" data-action="host">Online: Spiel erstellen</button>
        <div class="menu-join-row">
          <input class="menu-input" data-join-code placeholder="CODE" maxlength="6" />
          <button class="menu-btn menu-btn-small" data-action="join">Beitreten</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);

    const modeBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-mode]'));
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode as GameMode;
        modeBtns.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    const opponentBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-opponent]'));
    opponentBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.vsBot = btn.dataset.opponent === 'bot';
        opponentBtns.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    this.root.querySelector('[data-action="local"]')!.addEventListener('click', () => callbacks.onLocal(this.mode, this.vsBot));
    this.root.querySelector('[data-action="host"]')!.addEventListener('click', () => callbacks.onHost(this.mode));
    this.root.querySelector('[data-action="join"]')!.addEventListener('click', () => {
      const input = this.root.querySelector('[data-join-code]') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code) callbacks.onJoin(code, this.mode);
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
