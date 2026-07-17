import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';
import { engineSound } from '../audio/engineSound';

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * On-screen button controls for phones/tablets.
 *
 * Button-based (the old joystick was fiddly): two big steering arrows on the
 * left, action buttons on the right. Each button captures its own pointer, so
 * multitouch works and events can't be stolen by selection or other DOM.
 *
 * **layout 'race':** ◀ ▶ steer · NITRO · BREMSE. The car auto-accelerates
 *   (main.ts injects throttle=1) so there's no gas button.
 *
 * **layout 'manual' (derby):** ◀ ▶ steer · GAS · REVERSE (R). Full throttle
 *   control for combat.
 *
 * **layout 'parking':** ◀ ▶ steer · GAS pedal + gear selector R / D / P, like
 *   Dr. Parking. One pedal; the gear decides forward/back. P holds the car.
 */
export type TouchLayout = 'race' | 'manual' | 'parking';
export type Gear = 'R' | 'D' | 'P';

export class TouchControls {
  root: HTMLDivElement;
  readonly layout: TouchLayout;
  gear: Gear = 'D';

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

    let actions: string;
    if (layout === 'race') {
      // Real pedals (bottom→top thanks to column-reverse): big GAS, BREMSE, NITRO.
      actions = `<div class="touch-btn touch-gas touch-gas-race" data-hold="gas">GAS</div>
                 <div class="touch-btn touch-brake" data-hold="brake">BREMSE</div>
                 <div class="touch-btn touch-nitro" data-hold="nitro">NITRO</div>`;
    } else if (layout === 'parking') {
      actions = `<div class="touch-gears">
                   <div class="touch-btn touch-gear" data-gear="R">R</div>
                   <div class="touch-btn touch-gear active" data-gear="D">D</div>
                   <div class="touch-btn touch-gear" data-gear="P">P</div>
                 </div>
                 <div class="touch-btn touch-gas" data-hold="gas">GAS</div>`;
    } else {
      actions = `<div class="touch-btn touch-gas" data-hold="gas">GAS</div>
                 <div class="touch-btn touch-reverse" data-hold="reverse">R</div>`;
    }

    this.root.innerHTML = `
      <div class="touch-steer">
        <div class="touch-btn touch-arrow" data-hold="left" aria-label="links">‹</div>
        <div class="touch-btn touch-arrow" data-hold="right" aria-label="rechts">›</div>
      </div>
      <div class="touch-actions ${layout === 'parking' ? 'touch-actions-parking' : ''}">${actions}</div>
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

    // Gear selector (parking): tap to shift; each shift clunks.
    this.root.querySelectorAll<HTMLDivElement>('[data-gear]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setGear(el.dataset.gear as Gear);
      });
    });
  }

  setGear(gear: Gear) {
    if (gear === this.gear) return;
    this.gear = gear;
    this.root.querySelectorAll<HTMLDivElement>('[data-gear]').forEach((el) => {
      el.classList.toggle('active', el.dataset.gear === gear);
    });
    engineSound.playGearClick();
  }

  read(): CarInput {
    if (this.layout === 'parking') {
      const steer = (this.steerRight ? 1 : 0) - (this.steerLeft ? 1 : 0);
      const gearSign = this.gear === 'D' ? 1 : this.gear === 'R' ? -1 : 0;
      const throttle = this.gasHeld ? gearSign : 0;
      // Park gear holds the car; releasing the pedal also lets it settle.
      const brake = this.gear === 'P';
      if (!this.steerLeft && !this.steerRight && !this.gasHeld && !brake) return NEUTRAL_INPUT;
      return { throttle, steer, brake, nitro: false };
    }

    const anyHeld =
      this.steerLeft || this.steerRight || this.gasHeld || this.reverseHeld || this.brakeHeld || this.nitroHeld;
    if (!anyHeld) return NEUTRAL_INPUT;
    const steer = (this.steerRight ? 1 : 0) - (this.steerLeft ? 1 : 0);
    // Race: explicit GAS pedal. Manual (derby): gas + reverse buttons.
    const throttle = (this.gasHeld ? 1 : 0) - (this.layout === 'manual' && this.reverseHeld ? 1 : 0);
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
