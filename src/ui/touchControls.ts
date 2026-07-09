import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** Single-stick virtual joystick (steer + throttle/reverse) plus a brake button, for phones/tablets. */
export class TouchControls {
  root: HTMLDivElement;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private brakeBtn: HTMLDivElement;
  private pointerId: number | null = null;
  private dx = 0;
  private dy = 0;
  private brakeHeld = false;
  private baseCenter = { x: 0, y: 0 };
  private maxRadius = 55;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-joy-base" data-joy-base>
        <div class="touch-joy-knob" data-joy-knob></div>
      </div>
      <div class="touch-brake" data-brake>BREMSE</div>
    `;
    container.appendChild(this.root);

    this.base = this.root.querySelector('[data-joy-base]') as HTMLDivElement;
    this.knob = this.root.querySelector('[data-joy-knob]') as HTMLDivElement;
    this.brakeBtn = this.root.querySelector('[data-brake]') as HTMLDivElement;

    this.base.addEventListener('pointerdown', this.onStart);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onEnd);
    window.addEventListener('pointercancel', this.onEnd);

    this.brakeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.brakeHeld = true;
      this.brakeBtn.classList.add('active');
    });
    const releaseBrake = () => {
      this.brakeHeld = false;
      this.brakeBtn.classList.remove('active');
    };
    this.brakeBtn.addEventListener('pointerup', releaseBrake);
    this.brakeBtn.addEventListener('pointercancel', releaseBrake);
    this.brakeBtn.addEventListener('pointerleave', releaseBrake);
  }

  private onStart = (e: PointerEvent) => {
    e.preventDefault();
    this.pointerId = e.pointerId;
    const rect = this.base.getBoundingClientRect();
    this.baseCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateFromEvent(e);
  };

  private onMove = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    this.updateFromEvent(e);
  };

  private onEnd = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.dx = 0;
    this.dy = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
  };

  private updateFromEvent(e: PointerEvent) {
    let dx = e.clientX - this.baseCenter.x;
    let dy = e.clientY - this.baseCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxRadius) {
      dx = (dx / dist) * this.maxRadius;
      dy = (dy / dist) * this.maxRadius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.dx = dx / this.maxRadius;
    this.dy = dy / this.maxRadius;
  }

  read(): CarInput {
    if (this.pointerId === null && !this.brakeHeld) return NEUTRAL_INPUT;
    return {
      throttle: Math.abs(this.dy) > 0.08 ? -this.dy : 0,
      steer: Math.abs(this.dx) > 0.08 ? this.dx : 0,
      brake: this.brakeHeld,
    };
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onEnd);
    window.removeEventListener('pointercancel', this.onEnd);
    this.root.remove();
  }
}

/** Touch input wins over keyboard whenever it's actively being pushed; otherwise keyboard passes through untouched. */
export function combineInputs(keyboard: CarInput, touch: CarInput): CarInput {
  return {
    throttle: touch.throttle !== 0 ? touch.throttle : keyboard.throttle,
    steer: touch.steer !== 0 ? touch.steer : keyboard.steer,
    brake: touch.brake || keyboard.brake,
  };
}
