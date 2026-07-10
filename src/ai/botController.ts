import * as CANNON from 'cannon-es';
import type { CarEntity } from '../game/carEntity';
import type { CarInput } from '../input/input';

function forwardOf(car: CarEntity): { x: number; z: number } {
  const f = new CANNON.Vec3(1, 0, 0);
  car.body.quaternion.vmult(f, f);
  const len = Math.hypot(f.x, f.z) || 1;
  return { x: f.x / len, z: f.z / len };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Turns toward a world-space direction; returns the steer input needed to face it. */
function steerToward(car: CarEntity, dirX: number, dirZ: number): number {
  const forward = forwardOf(car);
  const currentAngle = Math.atan2(forward.z, forward.x);
  const desiredAngle = Math.atan2(dirZ, dirX);
  const diff = normalizeAngle(desiredAngle - currentAngle);
  return Math.max(-1, Math.min(1, diff * 2.2));
}

/**
 * Derby bot: chases the opponent to ram them, but breaks off the chase to steer back toward the
 * arena center whenever it strays too close to the (shrinking) edge — otherwise it would happily
 * drive itself off the platform mid-chase.
 */
export function deriveDerbyBotInput(bot: CarEntity, opponent: CarEntity, arenaRadius: number): CarInput {
  const pos = bot.body.position;
  const distFromCenter = Math.hypot(pos.x, pos.z);
  const edgeMargin = arenaRadius * 0.78;

  let dirX: number;
  let dirZ: number;
  if (distFromCenter > edgeMargin) {
    // Too close to the edge — steer back toward the middle regardless of the opponent's position.
    dirX = -pos.x / (distFromCenter || 1);
    dirZ = -pos.z / (distFromCenter || 1);
  } else {
    const dx = opponent.body.position.x - pos.x;
    const dz = opponent.body.position.z - pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    dirX = dx / dist;
    dirZ = dz / dist;
  }

  const steer = steerToward(bot, dirX, dirZ);
  return { throttle: 1, steer, brake: false, nitro: false };
}

/**
 * Race bot: follows the ring track's tangent direction, biased to correct back toward the
 * mid-line radius so it doesn't drift into the walls over a full lap.
 */
export function deriveRaceBotInput(bot: CarEntity, midRadius: number): CarInput {
  const pos = bot.body.position;
  const dist = Math.hypot(pos.x, pos.z) || 1;
  const angle = Math.atan2(pos.z, pos.x);
  const tangentX = -Math.sin(angle);
  const tangentZ = Math.cos(angle);

  const radialError = (midRadius - dist) / midRadius; // positive: too far in, needs to drift outward
  const correctionX = (pos.x / dist) * radialError * 0.6;
  const correctionZ = (pos.z / dist) * radialError * 0.6;

  const dirX = tangentX + correctionX;
  const dirZ = tangentZ + correctionZ;
  const steer = steerToward(bot, dirX, dirZ);
  return { throttle: 1, steer, brake: false, nitro: false };
}
