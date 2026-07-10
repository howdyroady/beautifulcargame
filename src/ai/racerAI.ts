import * as CANNON from 'cannon-es';
import type { CarEntity } from '../game/carEntity';
import type { CarInput } from '../input/input';
import type { Circuit } from '../track/circuit';

export interface RacerAIState {
  /** Last known curve parameter. */
  t: number;
  /** Per-bot personality 0.88 .. 1.04. */
  skill: number;
  /** Noise offset for natural variation. */
  noisePhase: number;
  /** Cooldown before next tactical nitro. */
  nitroCooldown: number;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Racing-line follower with tactical nitro, random steering noise for realism,
 * and speed-aware cornering. The "skill" parameter spreads the field naturally.
 */
export function deriveRacerInput(
  car: CarEntity,
  circuit: Circuit,
  state: RacerAIState,
  nitroCharge: number,
  raceTime = 0,
): CarInput {
  const pos = car.body.position;
  state.t = circuit.nearestT(pos.x, pos.z, state.t);

  const speed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
  const lookahead = 0.02 + Math.min(0.04, speed * 0.0016);
  const target = circuit.curve.getPointAt((state.t + lookahead) % 1);

  const f = new CANNON.Vec3(1, 0, 0);
  car.body.quaternion.vmult(f, f);
  const currentAngle = Math.atan2(f.z, f.x);
  const desiredAngle = Math.atan2(target.z - pos.z, target.x - pos.x);
  const diff = normalizeAngle(desiredAngle - currentAngle);

  // Steering noise — makes the bot weave slightly like a real driver.
  state.noisePhase += 0.03;
  const noise = Math.sin(state.noisePhase * 2.7 + state.skill * 100) * 0.06;
  const steer = Math.max(-1, Math.min(1, diff * 2.6 + noise));

  // Corner sharpness → throttle management
  const cornerSharpness = Math.abs(diff);
  let throttle: number = state.skill;
  if (cornerSharpness > 1.0 && speed > 8) throttle = 0.28;
  else if (cornerSharpness > 0.7 && speed > 10) throttle = 0.5;
  else if (cornerSharpness > 0.4 && speed > 13) throttle = 0.72;

  // Brake in very sharp corners at high speed
  const brake = cornerSharpness > 1.2 && speed > 12;

  // Tactical nitro: on straights, when tank is enough, with cooldown
  state.nitroCooldown = Math.max(0, state.nitroCooldown - 1 / 60);
  let nitro = false;
  if (nitroCharge > 0.45 && cornerSharpness < 0.12 && speed > 6 && state.nitroCooldown <= 0) {
    nitro = true;
    if (nitroCharge < 0.5) state.nitroCooldown = 2; // save some for later
  }

  return { throttle, steer, brake, nitro };
}
