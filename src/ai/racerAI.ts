import * as CANNON from 'cannon-es';
import type { CarEntity } from '../game/carEntity';
import type { CarInput } from '../input/input';
import type { Circuit } from '../track/circuit';

export interface RacerAIState {
  /** Last known curve parameter — the follower advances this each frame instead of searching globally. */
  t: number;
  /** Per-bot personality so the field spreads out: 0.92 (cautious) .. 1.02 (aggressive). */
  skill: number;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Racing-line follower: chases a lookahead point on the circuit spline. Lookahead scales with
 * speed so bots brake-steer smoothly into the hairpin instead of over-shooting it.
 */
export function deriveRacerInput(car: CarEntity, circuit: Circuit, state: RacerAIState, nitroCharge: number): CarInput {
  const pos = car.body.position;
  state.t = circuit.nearestT(pos.x, pos.z, state.t);

  const speed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
  const lookahead = 0.02 + Math.min(0.035, speed * 0.0015);
  const target = circuit.curve.getPointAt((state.t + lookahead) % 1);

  const f = new CANNON.Vec3(1, 0, 0);
  car.body.quaternion.vmult(f, f);
  const currentAngle = Math.atan2(f.z, f.x);
  const desiredAngle = Math.atan2(target.z - pos.z, target.x - pos.x);
  const diff = normalizeAngle(desiredAngle - currentAngle);
  const steer = Math.max(-1, Math.min(1, diff * 2.4));

  // Ease off the throttle in tight corners so the bot holds the line.
  const cornerSharpness = Math.abs(diff);
  let throttle: number = state.skill;
  if (cornerSharpness > 0.9 && speed > 9) throttle = 0.35;
  else if (cornerSharpness > 0.5 && speed > 12) throttle = 0.65;

  // Fire nitro on straights when the tank is full enough.
  const nitro = nitroCharge > 0.55 && cornerSharpness < 0.15;

  return { throttle, steer, brake: false, nitro };
}
