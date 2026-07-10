export interface CarInput {
  throttle: number; // -1..1 (reverse..forward)
  steer: number; // -1..1 (left..right)
  brake: boolean;
  nitro: boolean;
}

export const NEUTRAL_INPUT: CarInput = { throttle: 0, steer: 0, brake: false, nitro: false };

export type KeyScheme = 'wasd' | 'arrows';

const SCHEMES: Record<KeyScheme, { fwd: string; back: string; left: string; right: string; brake: string; nitro: string }> = {
  wasd: { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', brake: 'ShiftLeft', nitro: 'Space' },
  arrows: { fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', brake: 'ShiftRight', nitro: 'Enter' },
};

export class KeyboardInputSource {
  private pressed = new Set<string>();
  private scheme: ReturnType<typeof getScheme>;

  constructor(scheme: KeyScheme) {
    this.scheme = getScheme(scheme);
    window.addEventListener('keydown', (e) => {
      // Space/arrows scroll the page by default — that would wreck gameplay.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.pressed.add(e.code);
    });
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
    const nitro = this.pressed.has(s.nitro);
    return { throttle, steer, brake, nitro };
  }
}

function getScheme(scheme: KeyScheme) {
  return SCHEMES[scheme];
}
