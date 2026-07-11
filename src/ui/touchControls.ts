import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * On-screen button controls for phones/tablets.
 *
 * The old virtual joystick was fiddly — you had to find the stick, and a small
 * vertical wobble fought the steering. Players asked for plain arrows, so this
 * is button-based: two big steering arrows on the left, action buttons on the
 * right. Each button captures its own pointer, so multitouch (steer + nitro at
 * once) works, and events can't be stolen by selection or other DOM.
 *
 * **layout 'race':** ◀ ▶ steer · NITRO · BREMSE. The car auto-accelerates
 *   (main.ts injects throttle=1) so there's no gas button to hold.
 *
 * **layout 'manual' (parking / derby):** ◀ ▶ steer · GAS · REVERSE (R).
 *   Full throttle control for precise maneuvering and combat.
 */
export type TouchLayout = 'race' | 'manual';

export class TouchControls {
  root: HTMLDivElement;
  readonly layout: TouchLayout;

  private steerLeft = false;
  private steerRight = false;
  private gasHeld = false;
  private reverseHeld = false;
  private brakeHeld = false;
  private nitroHeld = false;

  constructor(container: HTMLElement, layout: TouchLayout = 'race') {
    this.layout = layout;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    const actions =
      layout === 'race'
        ? `<div class="touch-btn touch-nitro" data-hold="nitro">NITRO</div>
           <div class="touch-btn touch-brake" data-hold="brake">BREMSE</div>`
        : `<div class="touch-btn touch-gas" data-hold="gas">GAS</div>
           <div class="touch-btn touch-reverse" data-hold="reverse">R</div>`;

    this.root.innerHTML = `
      <div class="touch-steer">
        <div class="touch-btn touch-arrow" data-hold="left" aria-label="links">‹</div>
        <div class="touch-btn touch-arrow" data-hold="right" aria-label="rechts">›</div>
      </div>
      <div class="touch-actions">${actions}</div>
    `;
    container.appendChild(this.root);

    const setters: Record<string, (v: boolean) => void> = {
      left: (v) => (this.steerLeft = v),
      right: (v) => (this.steerRight = v),
      gas: (v) => (this.gasHeld = v),
      reverse: (v) => (this.reverseHeld = v),
      brake: (v) => (this.brakeHeld = v),
      nitro: (v) => (this.nitroHeld = v),
    };

    this.root.querySelectorAll<HTMLDivElement>('[data-hold]').forEach((el) => {
      const set = setters[el.dataset.hold!];
      const press = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* older browsers */
        }
        set(true);
        el.classList.add('active');
      };
      const release = () => {
        set(false);
        el.classList.remove('active');
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    });
  }

  read(): CarInput {
    const anyHeld =
      this.steerLeft || this.steerRight || this.gasHeld || this.reverseHeld || this.brakeHeld || this.nitroHeld;
    if (!anyHeld) return NEUTRAL_INPUT;
    const steer = (this.steerRight ? 1 : 0) - (this.steerLeft ? 1 : 0);
    // Race layout leaves throttle at 0 so main.ts can apply auto-gas; manual
    // layout drives forward/back from the gas & reverse buttons.
    const throttle = this.layout === 'manual' ? (this.gasHeld ? 1 : 0) - (this.reverseHeld ? 1 : 0) : 0;
    return { throttle, steer, brake: this.brakeHeld, nitro: this.nitroHeld };
  }

  destroy() {
    this.root.remove();
  }
}

/** Touch input wins over keyboard whenever a button is actively pressed. */
export function combineInputs(keyboard: CarInput, touch: CarInput): CarInput {
  return {
    throttle: touch.throttle !== 0 ? touch.throttle : keyboard.throttle,
    steer: touch.steer !== 0 ? touch.steer : keyboard.steer,
    brake: touch.brake || keyboard.brake,
    nitro: touch.nitro || keyboard.nitro,
  };
}
