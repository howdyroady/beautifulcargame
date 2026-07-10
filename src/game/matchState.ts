import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../physics/world';
import { Arena } from '../arena/arena';
import { CarEntity, type PowerupType } from './carEntity';
import { PowerupManager } from './powerups';
import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';
import { ParticlePool } from '../effects/particles';

export type MatchPhase = 'countdown' | 'fighting' | 'roundEnd' | 'matchEnd';

const ROUNDS_TO_WIN = 3;
const COUNTDOWN_SECONDS = 3;
const ROUND_END_PAUSE = 2.5;

export interface MatchCallbacks {
  onPhaseChange?: (phase: MatchPhase, data?: { winner?: number; countdown?: number }) => void;
  onHpChange?: (hp: [number, number]) => void;
  onScoreChange?: (score: [number, number]) => void;
  onCollisionSpark?: (x: number, z: number) => void;
}

const SPAWN_A = new CANNON.Vec3(-6, 1.2, 0);
const SPAWN_B = new CANNON.Vec3(6, 1.2, 0);

export class Match {
  scene: THREE.Scene;
  physics = createPhysicsWorld();
  arena: Arena;
  cars: [CarEntity, CarEntity];
  powerups: PowerupManager;
  particles: ParticlePool;
  phase: MatchPhase = 'countdown';
  score: [number, number] = [0, 0];
  private countdownRemaining = COUNTDOWN_SECONDS;
  private roundEndRemaining = 0;
  private callbacks: MatchCallbacks;
  private lastWinner?: number;
  matchTime = 0;

  constructor(scene: THREE.Scene, callbacks: MatchCallbacks = {}, playerColor = 0x9aa0a8) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.arena = new Arena(scene, this.physics.world, this.physics.groundMaterial);
    this.powerups = new PowerupManager(scene, () => this.arena.radius);
    this.particles = new ParticlePool(scene);

    // Opponent color contrasts with whatever the player picked.
    const opponentColor = playerColor === 0xa02828 ? 0x2054c0 : 0xb03030;
    const carA = new CarEntity(scene, this.physics.world, this.physics.carMaterial, playerColor, SPAWN_A, 0);
    const carB = new CarEntity(scene, this.physics.world, this.physics.carMaterial, opponentColor, SPAWN_B, Math.PI);
    this.cars = [carA, carB];

    this.setupCollisionDamage();
    this.callbacks.onPhaseChange?.(this.phase, { countdown: this.countdownRemaining });
  }

  private setupCollisionDamage() {
    const [a, b] = this.cars;
    const bind = (self: CarEntity, other: CarEntity) => {
      self.body.addEventListener('collide', (event: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
        if (event.body !== other.body) return;
        const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
        if (impact < 2.5) return;
        const raw = Math.min(40, Math.max(0, impact * 2.5 - 5));
        const damage = raw * other.ramMultiplier;
        if (damage <= 0) return;
        const absorbed = self.takeDamage(damage, self.matchTime);
        const midX = (self.body.position.x + other.body.position.x) / 2;
        const midZ = (self.body.position.z + other.body.position.z) / 2;
        if (!absorbed) {
          this.callbacks.onCollisionSpark?.(midX, midZ);
        }
        this.spawnCollisionSparks(midX, midZ, Math.min(1, impact / 20));
      });
    };
    bind(a, b);
    bind(b, a);
  }

  private spawnCollisionSparks(x: number, z: number, intensity: number) {
    const count = Math.round(4 + intensity * 6);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4 * intensity;
      const vel = new THREE.Vector3(Math.cos(angle) * speed, 1.5 + Math.random() * 2, Math.sin(angle) * speed);
      this.particles.spawn(new THREE.Vector3(x, 0.5, z), vel, {
        life: 0.35 + Math.random() * 0.2,
        size: 0.18,
        color: Math.random() > 0.5 ? 0xffcc55 : 0xff7733,
        opacity: 0.9,
        growth: -0.3,
        additive: true,
      });
    }
  }

  private setPhase(phase: MatchPhase, data?: { winner?: number; countdown?: number }) {
    this.phase = phase;
    if (data?.winner !== undefined) this.lastWinner = data.winner;
    this.callbacks.onPhaseChange?.(phase, data);
  }

  getSnapshot() {
    return {
      t: 'state' as const,
      phase: this.phase,
      countdown: Math.max(0, this.countdownRemaining),
      winner: this.lastWinner,
      score: this.score,
      arenaRadius: this.arena.radius,
      hazards: this.arena.getHazardSnapshot(),
      powerups: this.powerups.getSnapshot(),
      cars: [this.cars[0].getSnapshot(), this.cars[1].getSnapshot()] as [ReturnType<CarEntity['getSnapshot']>, ReturnType<CarEntity['getSnapshot']>],
    };
  }

  update(dt: number, inputA: CarInput, inputB: CarInput) {
    this.particles.update(dt);

    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt;
      this.callbacks.onPhaseChange?.('countdown', { countdown: Math.max(0, this.countdownRemaining) });
      if (this.countdownRemaining <= 0) this.setPhase('fighting');
      return;
    }

    if (this.phase === 'roundEnd') {
      this.roundEndRemaining -= dt;
      if (this.roundEndRemaining <= 0) this.startNextRound();
      return;
    }

    if (this.phase === 'matchEnd') return;

    // fighting
    this.matchTime += dt;
    this.arena.update(dt);

    const inputs: [CarInput, CarInput] = [inputA ?? NEUTRAL_INPUT, inputB ?? NEUTRAL_INPUT];
    this.cars.forEach((car, i) => {
      const pos = car.body.position;
      const effect = this.arena.effectAt(pos.x, pos.z);
      car.update(dt, inputs[i], effect, this.particles);
    });

    this.physics.step(dt);

    this.powerups.update(
      dt,
      this.matchTime,
      this.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })),
      (carIndex, type) => this.handlePickup(carIndex, type),
    );

    this.callbacks.onHpChange?.([this.cars[0].hp, this.cars[1].hp]);

    // Ring-out / KO checks.
    const [a, b] = this.cars;
    const aOut = this.arena.isOutOfBounds(a.body.position.x, a.body.position.y, a.body.position.z) || !a.alive;
    const bOut = this.arena.isOutOfBounds(b.body.position.x, b.body.position.y, b.body.position.z) || !b.alive;
    if (aOut || bOut) {
      let winner: number | undefined;
      if (aOut && !bOut) winner = 1;
      else if (bOut && !aOut) winner = 0;
      this.endRound(winner);
    }
  }

  private handlePickup(carIndex: number, type: PowerupType) {
    if (type === 'emp') {
      const opponent = this.cars[carIndex === 0 ? 1 : 0];
      opponent.effects.empUntil = opponent.matchTime + 2;
    } else {
      this.cars[carIndex].applyPowerup(type);
    }
  }

  private endRound(winner?: number) {
    if (winner !== undefined) {
      this.score[winner]++;
      this.callbacks.onScoreChange?.(this.score);
    }
    this.roundEndRemaining = ROUND_END_PAUSE;
    this.setPhase('roundEnd', { winner });

    if (this.score[0] >= ROUNDS_TO_WIN || this.score[1] >= ROUNDS_TO_WIN) {
      const matchWinner = this.score[0] >= ROUNDS_TO_WIN ? 0 : 1;
      setTimeout(() => this.setPhase('matchEnd', { winner: matchWinner }), ROUND_END_PAUSE * 1000);
    }
  }

  private startNextRound() {
    if (this.phase === 'matchEnd') return;
    this.arena.reset();
    this.powerups.reset();
    this.cars[0].reset(SPAWN_A, 0);
    this.cars[1].reset(SPAWN_B, Math.PI);
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.matchTime = 0;
    this.setPhase('countdown', { countdown: this.countdownRemaining });
  }

  resetMatch() {
    this.score = [0, 0];
    this.callbacks.onScoreChange?.(this.score);
    this.startNextRound();
  }
}
