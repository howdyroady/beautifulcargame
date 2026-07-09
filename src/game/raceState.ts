import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../physics/world';
import { Track } from '../arena/track';
import { CarEntity } from './carEntity';
import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';
import { ParticlePool } from '../effects/particles';

export type RacePhase = 'countdown' | 'racing' | 'finished';

const TOTAL_LAPS = 3;
const COUNTDOWN_SECONDS = 3;
const NO_TERRAIN_EFFECT = { friction: 1, boostX: 0, boostZ: 0 };

export interface RaceCallbacks {
  onPhaseChange?: (phase: RacePhase, data?: { winner?: number }) => void;
  onProgress?: (laps: [number, number], places: [number, number]) => void;
}

interface CarProgress {
  lastAngle: number;
  unwrapped: number;
}

export class RaceMatch {
  scene: THREE.Scene;
  physics = createPhysicsWorld();
  track: Track;
  cars: [CarEntity, CarEntity];
  particles: ParticlePool;
  phase: RacePhase = 'countdown';
  laps: [number, number] = [0, 0];
  private progress: [CarProgress, CarProgress];
  private countdownRemaining = COUNTDOWN_SECONDS;
  private callbacks: RaceCallbacks;
  private winner?: number;

  constructor(scene: THREE.Scene, callbacks: RaceCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.track = new Track(scene, this.physics.world, this.physics.groundMaterial, this.physics.groundMaterial);
    this.particles = new ParticlePool(scene);

    const mid = this.track.midRadius();
    const laneOffset = 1.3;
    const spawnAngleA = -0.06;
    const spawnAngleB = 0.06;
    const carA = new CarEntity(
      scene,
      this.physics.world,
      this.physics.carMaterial,
      0x9199a1,
      angleToSpawn(spawnAngleA, mid - laneOffset),
      -spawnAngleA - Math.PI / 2,
    );
    const carB = new CarEntity(
      scene,
      this.physics.world,
      this.physics.carMaterial,
      0xb03030,
      angleToSpawn(spawnAngleB, mid + laneOffset),
      -spawnAngleB - Math.PI / 2,
    );
    this.cars = [carA, carB];
    this.progress = [
      { lastAngle: spawnAngleA, unwrapped: 0 },
      { lastAngle: spawnAngleB, unwrapped: 0 },
    ];

    this.callbacks.onPhaseChange?.(this.phase);
  }

  private setPhase(phase: RacePhase, data?: { winner?: number }) {
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase, data);
  }

  private places(): [number, number] {
    return this.progress[0].unwrapped >= this.progress[1].unwrapped ? [1, 2] : [2, 1];
  }

  getSnapshot() {
    return {
      t: 'race-state' as const,
      phase: this.phase,
      countdown: Math.max(0, this.countdownRemaining),
      winner: this.winner,
      laps: this.laps,
      places: this.places(),
      cars: [this.cars[0].getSnapshot(), this.cars[1].getSnapshot()] as [ReturnType<CarEntity['getSnapshot']>, ReturnType<CarEntity['getSnapshot']>],
    };
  }

  update(dt: number, inputA: CarInput, inputB: CarInput) {
    this.particles.update(dt);

    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt;
      if (this.countdownRemaining <= 0) this.setPhase('racing');
      return;
    }
    if (this.phase === 'finished') return;

    const inputs: [CarInput, CarInput] = [inputA ?? NEUTRAL_INPUT, inputB ?? NEUTRAL_INPUT];
    this.cars.forEach((car, i) => car.update(dt, inputs[i], NO_TERRAIN_EFFECT, this.particles));
    this.physics.step(dt);

    this.cars.forEach((car, i) => {
      const p = this.progress[i];
      const angle = Math.atan2(car.body.position.z, car.body.position.x);
      let delta = angle - p.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      p.unwrapped += delta;
      p.lastAngle = angle;
      this.laps[i] = Math.max(0, Math.floor(p.unwrapped / (Math.PI * 2)));
    });

    this.callbacks.onProgress?.(this.laps, this.places());

    if (this.winner === undefined) {
      if (this.laps[0] >= TOTAL_LAPS) this.winner = 0;
      else if (this.laps[1] >= TOTAL_LAPS) this.winner = 1;
      if (this.winner !== undefined) this.setPhase('finished', { winner: this.winner });
    }
  }
}

function angleToSpawn(angle: number, radius: number): CANNON.Vec3 {
  return new CANNON.Vec3(Math.cos(angle) * radius, 1.2, Math.sin(angle) * radius);
}
