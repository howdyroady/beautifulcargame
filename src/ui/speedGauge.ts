/** Bottom-center speed readout, shared between the derby and race HUDs. */
export class SpeedGauge {
  root: HTMLDivElement;
  private valueEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'speed-gauge';
    this.root.innerHTML = `
      <div class="speed-value" data-value>0</div>
      <div class="speed-unit">km/h</div>
    `;
    container.appendChild(this.root);
    this.valueEl = this.root.querySelector('[data-value]') as HTMLDivElement;
  }

  setSpeed(kmh: number) {
    this.valueEl.textContent = String(Math.round(Math.max(0, kmh)));
  }

  destroy() {
    this.root.remove();
  }
}
