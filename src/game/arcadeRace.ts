import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../physics/world';
import { Circuit, TRACKS, type TrackConfig } from '../track/circuit';
import { CarEntity } from './carEntity';
import { attachHeadlights } from '../car/carModel';
import { ParticlePool } from '../effects/particles';
import { deriveRacerInput, type RacerAIState } from '../ai/racerAI';
import { Traffic } from './traffic';
import { SkidMarkPool } from '../effects/skidmarks';
import type { CarInput } from '../input/input';
import { NEUTRAL_INPUT } from '../input/input';
import { engineSound } from '../audio/engineSound';

export type ArcadePhase = 'countdown' | 'racing' | 'finished';

export interface RacerState {
  nitroCharge: number;
  nitroActive: boolean;
  lap: number;
  nextCp: number;
  finished: boolean;
  finishTime: number;
  airborne: boolean;
  lastJumpAt: number;
  /** Drift combo: continuous drift duration in seconds. */
  driftDuration: number;
  /** Total nitro earned in the current drift combo. */
  driftNitroEarned: number;
}

export interface StandingEntry {
  carIndex: number;
  name: string;
  lap: number;
  finished: boolean;
  finishTime: number;
}

export interface ArcadeRaceCallbacks {
  onPhaseChange?: (phase: ArcadePhase, data?: { countdown?: number }) => void;
  onHud?: (hud: { speed: number; nitro: number; lap: number; totalLaps: number; position: number; carCount: number; time: number }) => void;
  onFinish?: (standings: StandingEntry[]) => void;
  onShake?: (magnitude: number) => void;
  /** Drift combo callback for HUD. */
  onDrift?: (isDrifting: boolean, comboMultiplier: number, nitroEarned: number) => void;
  /** Fired when the player grabs a FREIE BAHN pickup (traffic phases out). */
  onTrafficCleared?: (seconds: number) => void;
  /** Fired when the player starts/stops driving against the track direction. */
  onWrongWay?: (active: boolean) => void;
}

export interface ArcadeRaceOptions {
  trackId: string;
  humanCount: 1 | 2;
  aiCount: number;
  playerColor: number;
  playerModel?: import('../car/carModel').CarModel;
  /** Slow "civilian" cars to weave through. Local single-player only. */
  trafficCount?: number;
}

const AI_COLORS = [0xb03030, 0x2054c0, 0xd0a020, 0x30a060, 0x8030a0];
const COUNTDOWN_SECONDS = 3;
// Base top ≈ 228 km/h, nitro top ≈ 308 km/h — hypercar numbers instead of the
// old 335+, and the taper in raycastCar makes the last stretch earned.
const NITRO_SPEED_MULT = 1.35;
const NITRO_DRAIN = 1 / 2.8;
const NEAR_MISS_DIST = 3.4;
const DRAFT_DIST = 6;
const DRAFT_ANGLE = 0.5; // radians, ~28°

export class ArcadeRace {
  scene: THREE.Scene;
  physics = createPhysicsWorld();
  circuit: Circuit;
  particles: ParticlePool;
  cars: CarEntity[] = [];
  racers: RacerState[] = [];
  names: string[] = [];
  humanCount: number;
  phase: ArcadePhase = 'countdown';
  raceTime = 0;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private aiStates: RacerAIState[] = [];
  private callbacks: ArcadeRaceCallbacks;
  private config: TrackConfig;
  private nearMissCooldown = new Map<string, number>();
  private finishedOrder: number[] = [];
  private resultsSent = false;
  private traffic: Traffic | null = null;
  private skids!: SkidMarkPool;
  /** FREIE BAHN pickups: grab one and traffic phases out for a few seconds. */
  private clearPickups: { pos: THREE.Vector3; mesh: THREE.Group; active: boolean; respawnAt: number }[] = [];
  private wrongWayTimer = 0;
  private wrongWayActive = false;
  private playerT = 0;

  constructor(scene: THREE.Scene, opts: ArcadeRaceOptions, callbacks: ArcadeRaceCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.humanCount = opts.humanCount;
    this.config = TRACKS[opts.trackId] ?? TRACKS.city;
    this.circuit = new Circuit(scene, this.physics.world, this.physics.groundMaterial, this.config, this.physics.wallMaterial);
    this.particles = new ParticlePool(scene, 200);
    this.skids = new SkidMarkPool(scene);

    const total = opts.humanCount + opts.aiCount;
    const curveLength = this.circuit.curve.getLength();

    for (let i = 0; i < total; i++) {
      const col = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const backDist = 5 + row * 7;
      const t = ((1 - backDist / curveLength) % 1 + 1) % 1;
      const point = this.circuit.curve.getPointAt(t);
      const tan = this.circuit.curve.getTangentAt(t).setY(0).normalize();
      const lft = new THREE.Vector3(-tan.z, 0, tan.x);
      const gridPos = point.clone().addScaledVector(lft, col * 2.2);
      const heading = Math.atan2(-tan.z, tan.x);
      const isHuman = i < opts.humanCount;
      const color = isHuman
        ? (i === 0 ? opts.playerColor : 0xf0f0f0)
        : AI_COLORS[(i - opts.humanCount) % AI_COLORS.length];
      const car = new CarEntity(
        scene,
        this.physics.world,
        this.physics.carMaterial,
        color,
        new CANNON.Vec3(gridPos.x, 1.0, gridPos.z),
        heading,
        i === 0 ? opts.playerModel : undefined,
      );
      this.cars.push(car);
      this.racers.push({
        nitroCharge: 0.3,
        nitroActive: false,
        lap: 0,
        nextCp: 1,
        finished: false,
        finishTime: 0,
        airborne: false,
        lastJumpAt: -10,
        driftDuration: 0,
        driftNitroEarned: 0,
      });
      this.names.push(isHuman ? (i === 0 ? 'DU' : 'SPIELER 2') : `BOT ${i - opts.humanCount + 1}`);
      if (!isHuman) {
        this.aiStates.push({ t: 0, skill: 0.88 + Math.random() * 0.16, noisePhase: Math.random() * 100, nitroCooldown: 0 });
      }
      this.attachCrashSound(car, i === 0);
      if (i === 0) attachHeadlights(car.model);
    }

    const trafficN = Math.min(14, Math.round((opts.trafficCount ?? 0) * (this.config.trafficDensity ?? 1)));
    if (trafficN > 0) {
      this.traffic = new Traffic(scene, this.physics.world, this.circuit, this.physics.carMaterial, trafficN);
      this.buildClearPickups();
    }

    this.callbacks.onPhaseChange?.(this.phase, { countdown: COUNTDOWN_SECONDS });
  }

  /** Cyan glowing rings on the racing line — collect for a few seconds of empty road. */
  private buildClearPickups() {
    for (const t of [0.22, 0.55, 0.85]) {
      const pos = this.circuit.curve.getPointAt(t).clone();
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.15, 0.1, 10, 28),
        new THREE.MeshStandardMaterial({ color: 0x50f0ff, emissive: 0x18c0ff, emissiveIntensity: 3.2, roughness: 0.2 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1;
      group.add(ring);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.4),
        new THREE.MeshStandardMaterial({ color: 0xd0f8ff, emissive: 0x80e0ff, emissiveIntensity: 2.6, roughness: 0.15 }),
      );
      core.position.y = 1;
      group.add(core);
      group.position.set(pos.x, 0, pos.z);
      this.scene.add(group);
      this.clearPickups.push({ pos, mesh: group, active: true, respawnAt: 0 });
    }
  }

  private updateClearPickups(dt: number) {
    for (const p of this.clearPickups) {
      if (!p.active) {
        if (this.raceTime >= p.respawnAt) {
          p.active = true;
          p.mesh.visible = true;
        }
        continue;
      }
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.children[1].position.y = 1 + Math.sin(this.raceTime * 2.6 + p.pos.x) * 0.16;
      // Only human players trigger it — bots shouldn't waste the ghost window.
      for (let h = 0; h < this.humanCount; h++) {
        const c = this.cars[h].body.position;
        const dx = c.x - p.pos.x;
        const dz = c.z - p.pos.z;
        if (dx * dx + dz * dz < 2.6 * 2.6) {
          p.active = false;
          p.mesh.visible = false;
          p.respawnAt = this.raceTime + 22;
          this.traffic?.setGhost(6);
          engineSound.playNitro();
          this.callbacks.onTrafficCleared?.(6);
          break;
        }
      }
    }
  }

  private attachCrashSound(car: CarEntity, isPlayer: boolean) {
    car.body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
      const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (impact < 3.5) return;
      engineSound.playCrash(Math.min(1, impact / 16));
      if (isPlayer) this.callbacks.onShake?.(Math.min(0.25, impact * 0.015));
      const p = car.body.position;
      this.particles.spawnBurst(new THREE.Vector3(p.x, 0.5, p.z), 6 + Math.floor(impact));
    });
  }

  standings(): StandingEntry[] {
    const progress = (i: number) => {
      const r = this.racers[i];
      const cp = this.circuit.checkpoints[r.nextCp % this.circuit.checkpoints.length];
      const p = this.cars[i].body.position;
      const dist = Math.hypot(cp.x - p.x, cp.z - p.z);
      return r.lap * 1000 + r.nextCp * 10 - dist * 0.001;
    };
    const order = this.cars.map((_, i) => i).sort((a, b) => {
      const ra = this.racers[a];
      const rb = this.racers[b];
      if (ra.finished && rb.finished) return ra.finishTime - rb.finishTime;
      if (ra.finished) return -1;
      if (rb.finished) return 1;
      return progress(b) - progress(a);
    });
    return order.map((carIndex) => ({
      carIndex,
      name: this.names[carIndex],
      lap: this.racers[carIndex].lap,
      finished: this.racers[carIndex].finished,
      finishTime: this.racers[carIndex].finishTime,
    }));
  }

  positionOf(carIndex: number): number {
    return this.standings().findIndex((s) => s.carIndex === carIndex) + 1;
  }

  update(dt: number, humanInputs: CarInput[]) {
    this.particles.update(dt);
    this.circuit.updatePickups(dt, this.raceTime);
    this.traffic?.update(dt);

    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt;
      this.callbacks.onPhaseChange?.('countdown', { countdown: Math.max(0, this.countdownRemaining) });
      if (this.countdownRemaining <= 0) {
        this.phase = 'racing';
        this.callbacks.onPhaseChange?.('racing');
      }
      return;
    }

    this.raceTime += dt;
    this.updateClearPickups(dt);
    this.updateWrongWay(dt);

    // Rubber-banding
    const order = this.standings();
    const rank = new Map<number, number>();
    order.forEach((s, idx) => rank.set(s.carIndex, idx));

    let aiIdx = 0;
    this.cars.forEach((car, i) => {
      const racer = this.racers[i];
      let input: CarInput;
      if (i < this.humanCount) {
        input = humanInputs[i] ?? NEUTRAL_INPUT;
      } else {
        input = deriveRacerInput(car, this.circuit, this.aiStates[aiIdx], racer.nitroCharge, this.raceTime);
        aiIdx++;
      }

      // --- Nitro management ---
      if (input.nitro && racer.nitroCharge > 0.05 && !racer.finished) {
        if (!racer.nitroActive) engineSound.playNitro();
        racer.nitroActive = true;
      }
      if (!input.nitro || racer.nitroCharge <= 0) racer.nitroActive = false;
      if (racer.nitroActive) {
        racer.nitroCharge = Math.max(0, racer.nitroCharge - NITRO_DRAIN * dt);
        car.effects.nitroUntil = car.matchTime + 0.15;
      }

      const speed = Math.hypot(car.body.velocity.x, car.body.velocity.z);

      // --- Drift combo system ---
      if (car.isDrifting && !racer.finished) {
        racer.driftDuration += dt;
        // Nitro earned scales with drift duration (combo multiplier)
        const comboMult = 1 + Math.min(4, racer.driftDuration * 0.8);
        const earned = dt * 0.18 * comboMult;
        racer.nitroCharge = Math.min(1, racer.nitroCharge + earned);
        racer.driftNitroEarned += earned;
      } else {
        racer.driftDuration = 0;
        racer.driftNitroEarned = 0;
      }

      // Trickle charge
      racer.nitroCharge = Math.min(1, racer.nitroCharge + dt * 0.012);

      // Pickups
      if (this.circuit.tryCollectPickup(car.body.position.x, car.body.position.z, this.raceTime)) {
        racer.nitroCharge = Math.min(1, racer.nitroCharge + 0.35);
      }

      // Jump pads
      for (const pad of this.circuit.jumpPads) {
        const dx = car.body.position.x - pad.pos.x;
        const dz = car.body.position.z - pad.pos.z;
        if (dx * dx + dz * dz < pad.radius * pad.radius && car.body.position.y < 1.0 && this.raceTime - racer.lastJumpAt > 1.5) {
          car.body.velocity.y = 8;
          racer.lastJumpAt = this.raceTime;
          racer.airborne = true;
        }
      }
      if (racer.airborne && car.body.position.y < 0.9 && this.raceTime - racer.lastJumpAt > 0.4) {
        racer.airborne = false;
        racer.nitroCharge = Math.min(1, racer.nitroCharge + 0.25);
      }

      // Boost strips
      let boostX = 0;
      let boostZ = 0;
      for (const pad of this.circuit.boostPads) {
        const dx = car.body.position.x - pad.pos.x;
        const dz = car.body.position.z - pad.pos.z;
        if (dx * dx + dz * dz < pad.radius * pad.radius) {
          boostX = pad.dir.x * 18;
          boostZ = pad.dir.z * 18;
        }
      }

      // Drafting: if directly behind another car, get a speed boost
      let draftBoost = 0;
      if (!racer.finished && speed > 5) {
        const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(
          new THREE.Quaternion(car.body.quaternion.x, car.body.quaternion.y, car.body.quaternion.z, car.body.quaternion.w),
        );
        for (let j = 0; j < this.cars.length; j++) {
          if (j === i) continue;
          const op = this.cars[j].body.position;
          const toOther = new THREE.Vector3(op.x - car.body.position.x, 0, op.z - car.body.position.z);
          const dist = toOther.length();
          if (dist < DRAFT_DIST && dist > 2) {
            toOther.normalize();
            const dot = fwd.x * toOther.x + fwd.z * toOther.z;
            if (dot > Math.cos(DRAFT_ANGLE)) {
              draftBoost = Math.max(draftBoost, 0.08 * (1 - dist / DRAFT_DIST));
            }
          }
        }
      }

      // Rubber-banding: stronger for back of pack
      const posRank = rank.get(i) ?? 0;
      const totalCars = this.cars.length;
      const rubberFactor = racer.finished ? 1 : 1 + (posRank - (totalCars - 1) / 2) * -0.04;
      const friction = (racer.nitroActive ? NITRO_SPEED_MULT : 1) * rubberFactor * (1 + draftBoost);
      car.update(dt, racer.finished ? NEUTRAL_INPUT : input, { friction, boostX, boostZ }, this.particles);

      // Rubber on the road: lay skid marks while drifting or braking at speed.
      const carSpeed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
      if (car.isDrifting || (input.brake && carSpeed > 6)) {
        const f = new CANNON.Vec3(1, 0, 0);
        car.body.quaternion.vmult(f, f);
        const fl = Math.hypot(f.x, f.z) || 1;
        const fx = f.x / fl;
        const fz = f.z / fl;
        const rx = -fz;
        const rz = fx;
        const dims = car.model.dims;
        const wheelX = dims.length * 0.33;
        const wheelZ = dims.width / 2 - 0.06;
        const angle = Math.atan2(-fx, -fz);
        const p = car.body.position;
        for (const s of [1, -1]) {
          this.skids.drop(
            `${i}:${s}`,
            p.x - fx * wheelX + rx * wheelZ * s,
            p.z - fz * wheelX + rz * wheelZ * s,
            angle,
          );
        }
      }
    });

    this.physics.step(dt);
    this.checkNearMisses();
    this.updateProgress();

    // Player HUD
    const player = this.racers[0];
    this.callbacks.onHud?.({
      speed: this.cars[0].speedKmh,
      nitro: player.nitroCharge,
      lap: Math.min(player.lap + 1, this.config.laps),
      totalLaps: this.config.laps,
      position: this.positionOf(0),
      carCount: this.cars.length,
      time: this.raceTime,
    });

    // Drift combo callback
    const comboMult = 1 + Math.min(4, player.driftDuration * 0.8);
    this.callbacks.onDrift?.(this.cars[0].isDrifting, comboMult, player.driftNitroEarned);

    // Race end
    if (!this.resultsSent && this.racers.slice(0, this.humanCount).every((r) => r.finished)) {
      this.resultsSent = true;
      this.phase = 'finished';
      this.callbacks.onPhaseChange?.('finished');
      this.callbacks.onFinish?.(this.standings());
    }
  }

  /**
   * Wrong-way detection for the player: compare the velocity against the track
   * tangent at the nearest curve point. A short grace timer filters out spins
   * and sideways moments — the warning only fires after driving backwards for
   * real (~0.8 s), and clears the instant the direction is right again.
   */
  private updateWrongWay(dt: number) {
    if (this.racers[0].finished) {
      if (this.wrongWayActive) {
        this.wrongWayActive = false;
        this.callbacks.onWrongWay?.(false);
      }
      return;
    }
    const p = this.cars[0].body.position;
    this.playerT = this.circuit.nearestT(p.x, p.z, this.playerT);
    const tan = this.circuit.curve.getTangentAt(this.playerT).setY(0).normalize();
    const v = this.cars[0].body.velocity;
    const speed = Math.hypot(v.x, v.z);
    const goingBackwards = speed > 4 && (v.x * tan.x + v.z * tan.z) / speed < -0.35;

    this.wrongWayTimer = goingBackwards ? this.wrongWayTimer + dt : 0;
    const shouldWarn = this.wrongWayTimer > 0.8;
    if (shouldWarn !== this.wrongWayActive) {
      this.wrongWayActive = shouldWarn;
      this.callbacks.onWrongWay?.(shouldWarn);
    }
  }

  private updateProgress() {
    const cps = this.circuit.checkpoints;
    const passRadius = this.config.width * 0.95;
    this.cars.forEach((car, i) => {
      const r = this.racers[i];
      if (r.finished) return;
      const cp = cps[r.nextCp % cps.length];
      const dx = car.body.position.x - cp.x;
      const dz = car.body.position.z - cp.z;
      if (dx * dx + dz * dz < passRadius * passRadius) {
        r.nextCp++;
        if (r.nextCp % cps.length === 0 && r.nextCp > 0) {
          r.lap++;
          if (r.lap >= this.config.laps) {
            r.finished = true;
            r.finishTime = this.raceTime;
            this.finishedOrder.push(i);
          }
        }
      }
    });
  }

  private checkNearMisses() {
    for (let a = 0; a < this.cars.length; a++) {
      for (let b = a + 1; b < this.cars.length; b++) {
        const pa = this.cars[a].body.position;
        const pb = this.cars[b].body.position;
        const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
        const key = `${a}-${b}`;
        const last = this.nearMissCooldown.get(key) ?? -10;
        if (d < NEAR_MISS_DIST && d > 1.9 && this.raceTime - last > 2) {
          const relSpeed = Math.hypot(
            this.cars[a].body.velocity.x - this.cars[b].body.velocity.x,
            this.cars[a].body.velocity.z - this.cars[b].body.velocity.z,
          );
          if (relSpeed > 3.5) {
            this.nearMissCooldown.set(key, this.raceTime);
            this.racers[a].nitroCharge = Math.min(1, this.racers[a].nitroCharge + 0.2);
            this.racers[b].nitroCharge = Math.min(1, this.racers[b].nitroCharge + 0.2);
          }
        }
      }
    }
  }

  getSnapshot() {
    const places = [this.positionOf(0), this.positionOf(1)] as [number, number];
    return {
      t: 'race-state' as const,
      phase: this.phase === 'racing' ? ('racing' as const) : this.phase === 'finished' ? ('finished' as const) : ('countdown' as const),
      countdown: Math.max(0, this.countdownRemaining),
      winner: this.finishedOrder.length ? (this.finishedOrder[0] === 0 ? 0 : 1) : undefined,
      trackId: this.config.id,
      time: this.raceTime,
      laps: [this.racers[0].lap, this.racers[1]?.lap ?? 0] as [number, number],
      places,
      nitro: [this.racers[0].nitroCharge, this.racers[1]?.nitroCharge ?? 0] as [number, number],
      cars: [this.cars[0].getSnapshot(), (this.cars[1] ?? this.cars[0]).getSnapshot()] as [
        ReturnType<CarEntity['getSnapshot']>,
        ReturnType<CarEntity['getSnapshot']>,
      ],
    };
  }
}
