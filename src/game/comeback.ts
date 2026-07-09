/** Subtle Mario-Kart-style rubber-banding: a car that's badly hurt gets a small edge, not a guarantee. */
export interface ComebackBuff {
  speedMultiplier: number;
  handlingMultiplier: number;
}

const THRESHOLD = 0.3; // below 30% HP
const MAX_SPEED_BONUS = 0.18;
const MAX_HANDLING_BONUS = 0.22;

export function computeComebackBuff(hp: number, maxHp: number): ComebackBuff {
  const ratio = Math.max(0, hp / maxHp);
  if (ratio >= THRESHOLD) return { speedMultiplier: 1, handlingMultiplier: 1 };
  const deficit = (THRESHOLD - ratio) / THRESHOLD; // 0..1, 1 when hp is 0
  return {
    speedMultiplier: 1 + MAX_SPEED_BONUS * deficit,
    handlingMultiplier: 1 + MAX_HANDLING_BONUS * deficit,
  };
}
