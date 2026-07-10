import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Virtual joystick + action buttons for phones/tablets.
 *
 * **steeringOnly = true (default, for racing):**
 *   Stick moves horizontally only (like a steering wheel). The car auto-accelerates;
 *   main.ts injects throttle=1 unless braking. This fixes the old bug where a tiny
 *   vertical stick offset produced a throttle too weak to overcome static friction.
 *
 * **steeringOnly = false (parking mode):**
 *   Stick Y axis controls forward/reverse as before.
 *
 * Pointer events use setPointerCapture on the base element and listen there (not on
 * window) — this prevents events being stolen by overlays, selection, or other DOM.
 */
export class TouchControls {
  root: HTMLDivElement;
  steeringOnly = true;

  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private brakeBtn: HTMLDivElement;
  private nitroBtn: HTMLDivElement;
  private pointerId: number | null = null;
  private dx = 0;
  private dy = 0;
  private brakeHeld = false;
  private nitroHeld = false;
  private baseCenter = { x: 0, y: 0 };
  private maxRadius = 55;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-joy-base" data-joy-base>
        <div class="touch-joy-track"></div>
        <div class="touch-joy-knob" data-joy-knob></div>
      </div>
      <div class="touch-nitro" data-nitro>NITRO</div>
      <div class="touch-brake" data-brake>BREMSE</div>
    `;
    container.appendChild(this.root);

    this.base = this.root.querySelector('[data-joy-base]') as HTMLDivElement;
    this.knob = this.root.querySelector('[data-joy-knob]') as HTMLDivElement;
    this.brakeBtn = this.root.querySelector('[data-brake]') as HTMLDivElement;
    this.nitroBtn = this.root.querySelector('[data-nitro]') as HTMLDivElement;

    // All pointer events on the base element via capture — never on window.
    this.base.addEventListener('pointerdown', this.onStart);
    this.base.addEventListener('pointermove', this.onMove);
    this.base.addEventListener('pointerup', this.onEnd);
    this.base.addEventListener('pointercancel', this.onEnd);
    this.base.addEventListener('lostpointercapture', this.onEnd);

    const bindHold = (el: HTMLDivElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        set(true);
        el.classList.add('active');
      });
      const release = () => {
        set(false);
        el.classList.remove('active');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };
    bindHold(this.brakeBtn, (v) => (this.brakeHeld = v));
    bindHold(this.nitroBtn, (v) => (this.nitroHeld = v));
  }

  private onStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.pointerId = e.pointerId;
    try {
      this.base.setPointerCapture(e.pointerId);
    } catch { /* older browsers */ }
    const rect = this.base.getBoundingClientRect();
    this.baseCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateFromEvent(e);
  };

  private onMove = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    this.updateFromEvent(e);
  };

  private onEnd = (e: PointerEvent) => {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.dx = 0;
    this.dy = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
  };

  private updateFromEvent(e: PointerEvent) {
    let dx = e.clientX - this.baseCenter.x;
    let dy = e.clientY - this.baseCenter.y;

    if (this.steeringOnly) {
      // Horizontal only — like a steering wheel.
      dy = 0;
      dx = Math.max(-this.maxRadius, Math.min(this.maxRadius, dx));
      this.knob.style.transform = `translate(${dx}px, 0px)`;
    } else {
      const dist = Math.hypot(dx, dy);
      if (dist > this.maxRadius) {
        dx = (dx / dist) * this.maxRadius;
        dy = (dy / dist) * this.maxRadius;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    this.dx = dx / this.maxRadius;
    this.dy = dy / this.maxRadius;
  }

  read(): CarInput {
    if (this.pointerId === null && !this.brakeHeld && !this.nitroHeld) return NEUTRAL_INPUT;
    return {
      // In steeringOnly mode, throttle is always 0 — main.ts handles auto-gas.
      // In parking mode, dy maps to throttle as before.
      throttle: this.steeringOnly ? 0 : (Math.abs(this.dy) > 0.06 ? -this.dy : 0),
      steer: Math.abs(this.dx) > 0.04 ? this.dx : 0,
      brake: this.brakeHeld,
      nitro: this.nitroHeld,
    };
  }

  destroy() {
    this.base.removeEventListener('pointerdown', this.onStart);
    this.base.removeEventListener('pointermove', this.onMove);
    this.base.removeEventListener('pointerup', this.onEnd);
    this.base.removeEventListener('pointercancel', this.onEnd);
    this.base.removeEventListener('lostpointercapture', this.onEnd);
    this.root.remove();
  }
}

/** Touch input wins over keyboard whenever it's actively being pushed. */
export function combineInputs(keyboard: CarInput, touch: CarInput): CarInput {
  return {
    throttle: touch.throttle !== 0 ? touch.throttle : keyboard.throttle,
    steer: touch.steer !== 0 ? touch.steer : keyboard.steer,
    brake: touch.brake || keyboard.brake,
    nitro: touch.nitro || keyboard.nitro,
  };
}
