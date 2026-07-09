export interface CarInput {
  throttle: number; // -1..1 (reverse..forward)
  steer: number; // -1..1 (left..right)
  brake: boolean;
}

export const NEUTRAL_INPUT: CarInput = { throttle: 0, steer: 0, brake: false };

export type KeyScheme = 'wasd' | 'arrows';

const SCHEMES: Record<KeyScheme, { fwd: string; back: string; left: string; right: string; brake: string }> = {
  wasd: { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', brake: 'ShiftLeft' },
  arrows: { fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', brake: 'ShiftRight' },
};

export class KeyboardInputSource {
  private pressed = new Set<string>();
  private scheme: ReturnType<typeof getScheme>;

  constructor(scheme: KeyScheme) {
    this.scheme = getScheme(scheme);
    window.addEventListener('keydown', (e) => this.pressed.add(e.code));
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
  }

  read(): CarInput {
    const s = this.scheme;
    let throttle = 0;
    if (this.pressed.has(s.fwd)) throttle += 1;
    if (this.pressed.has(s.back)) throttle -= 1;
    let steer = 0;
    if (this.pressed.has(s.left)) steer -= 1;
    if (this.pressed.has(s.right)) steer += 1;
    const brake = this.pressed.has(s.brake);
    return { throttle, steer, brake };
  }
}

function getScheme(scheme: KeyScheme) {
  return SCHEMES[scheme];
}
