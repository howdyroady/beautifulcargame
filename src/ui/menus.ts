export interface MainMenuCallbacks {
  onLocal: () => void;
  onHost: () => void;
  onJoin: (code: string) => void;
}

export class MainMenu {
  root: HTMLDivElement;

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <h1 class="menu-title">ROADRAGE<span>DERBY</span></h1>
      <p class="menu-sub">Ramm deinen Gegner von der schrumpfenden Plattform. Power-Ups entscheiden mit.</p>
      <div class="menu-buttons">
        <button class="menu-btn" data-action="local">Lokal · WASD vs Pfeiltasten</button>
        <button class="menu-btn" data-action="host">Online: Spiel erstellen</button>
        <div class="menu-join-row">
          <input class="menu-input" data-join-code placeholder="CODE" maxlength="6" />
          <button class="menu-btn menu-btn-small" data-action="join">Beitreten</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);

    this.root.querySelector('[data-action="local"]')!.addEventListener('click', () => callbacks.onLocal());
    this.root.querySelector('[data-action="host"]')!.addEventListener('click', () => callbacks.onHost());
    this.root.querySelector('[data-action="join"]')!.addEventListener('click', () => {
      const input = this.root.querySelector('[data-join-code]') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code) callbacks.onJoin(code);
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
