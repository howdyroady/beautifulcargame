import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel, type CarModel } from '../car/carModel';
import { createCarBody, applyCarControl, computeSlipAngle, DEFAULT_CAR_CONFIG } from '../physics/carPhysics';
import { computeComebackBuff } from './comeback';
import type { CarInput } from '../input/input';
import type { ParticlePool } from '../effects/particles';

export const MAX_HP = 100;

export type PowerupType = 'nitro' | 'shield' | 'emp' | 'ram';

export interface CarEffects {
  shieldCharges: number;
  ramUntil: number;
  nitroUntil: number;
  empUntil: number;
}

export class CarEntity {
  model: CarModel;
  body: CANNON.Body;
  hp = MAX_HP;
  alive = true;
  effects: CarEffects = { shieldCharges: 0, ramUntil: 0, nitroUntil: 0, empUntil: 0 };
  /** Current drift/slip angle in radians. */
  slipAngle = 0;
  /** True if the car is currently in a drift (slip > threshold). */
  isDrifting = false;
  private lastHitAt = 0;
  private smokeTimer = 0;
  matchTime = 0;
  private suspensionOffset = 0;
  private lastVelY = 0;

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    carMaterial: CANNON.Material,
    color: number,
    spawn: CANNON.Vec3,
    facing: number,
    prebuiltModel?: CarModel,
  ) {
    this.model = prebuiltModel ?? createCarModel(color);
    scene.add(this.model.group);
    this.body = createCarBody(this.model.dims, carMaterial, spawn);
    this.body.quaternion.setFromEuler(0, facing, 0);
    world.addBody(this.body);
    this.syncMesh();
  }

  applyPowerup(type: PowerupType) {
    const now = this.matchTime;
    switch (type) {
      case 'shield':
        this.effects.shieldCharges = Math.min(2, this.effects.shieldCharges + 1);
        break;
      case 'ram':
        this.effects.ramUntil = now + 5;
        break;
      case 'nitro':
        this.effects.nitroUntil = now + 3;
        break;
      case 'emp':
        this.effects.empUntil = now + 2;
        break;
    }
  }

  get isEmpDisabled() {
    return this.matchTime < this.effects.empUntil;
  }

  get ramMultiplier() {
    return this.matchTime < this.effects.ramUntil ? 2 : 1;
  }

  get nitroSpeedMultiplier() {
    return this.matchTime < this.effects.nitroUntil ? 1.6 : 1;
  }

  get speedKmh() {
    return Math.hypot(this.body.velocity.x, this.body.velocity.z) * 12;
  }

  takeDamage(amount: number, now: number): boolean {
    if (now - this.lastHitAt < 0.35) return true;
    this.lastHitAt = now;
    if (this.effects.shieldCharges > 0) {
      this.effects.shieldCharges -= 1;
      return true;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.alive = false;
    return false;
  }

  reset(spawn: CANNON.Vec3, facing: number) {
    this.hp = MAX_HP;
    this.alive = true;
    this.effects = { shieldCharges: 0, ramUntil: 0, nitroUntil: 0, empUntil: 0 };
    this.body.position.copy(spawn);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.quaternion.setFromEuler(0, facing, 0);
    this.syncMesh();
  }

  update(dt: number, input: CarInput, terrainEffect: { friction: number; boostX: number; boostZ: number }, particles?: ParticlePool) {
    this.matchTime += dt;
    const comeback = computeComebackBuff(this.hp, MAX_HP);
    const speedMult = comeback.speedMultiplier * this.nitroSpeedMultiplier * terrainEffect.friction;
    const effectiveInput: CarInput = this.isEmpDisabled
      ? { throttle: input.throttle * 0.3, steer: input.steer * -0.4, brake: input.brake, nitro: false }
      : input;

    applyCarControl(this.body, effectiveInput, dt, DEFAULT_CAR_CONFIG, speedMult, comeback.handlingMultiplier);

    if (terrainEffect.boostX !== 0 || terrainEffect.boostZ !== 0) {
      this.body.applyForce(new CANNON.Vec3(terrainEffect.boostX * 45, 0, terrainEffect.boostZ * 45), new CANNON.Vec3());
    }

    // Drift detection
    this.slipAngle = computeSlipAngle(this.body);
    this.isDrifting = this.slipAngle > 0.25 && Math.hypot(this.body.velocity.x, this.body.velocity.z) > 5;

    // Visual suspension: body bobs on vertical velocity changes (landing, bumps)
    const velYDelta = this.body.velocity.y - this.lastVelY;
    this.lastVelY = this.body.velocity.y;
    this.suspensionOffset += velYDelta * 0.015;
    this.suspensionOffset *= 0.88; // dampen

    this.syncMesh();

    // Brake lights
    this.model.setBrakeLights?.(input.brake);
    this.model.setNitroGlow?.(this.nitroSpeedMultiplier > 1);

    if (particles) this.updateEffects(dt, input, particles);
  }

  private forwardVector(): THREE.Vector3 {
    const f = new CANNON.Vec3(1, 0, 0);
    this.body.quaternion.vmult(f, f);
    return new THREE.Vector3(f.x, 0, f.z).normalize();
  }

  private updateEffects(dt: number, input: CarInput, particles: ParticlePool) {
    this.smokeTimer -= dt;
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    const forward = this.forwardVector();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const rearCenter = new THREE.Vector3(this.body.position.x, 0.15, this.body.position.z)
      .addScaledVector(forward, -this.model.dims.length * 0.42);

    // Drift smoke (thicker when drifting hard)
    const drifting = this.isDrifting;
    const braking = input.brake && speed > 3;
    if ((drifting || braking) && this.smokeTimer <= 0) {
      this.smokeTimer = drifting ? 0.04 : 0.06;
      for (const side of [-1, 1]) {
        const pos = rearCenter.clone().addScaledVector(right, side * this.model.dims.width * 0.4);
        const vel = new THREE.Vector3(
          (Math.random() - 0.5) * 0.7,
          0.6 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.7,
        );
        particles.spawn(pos, vel, {
          life: drifting ? 0.9 : 0.6,
          size: drifting ? 0.42 : 0.3,
          color: 0xbfc2c8,
          opacity: drifting ? 0.4 : 0.28,
          growth: 0.65,
        });
      }
      // Drift sparks
      if (drifting && Math.random() > 0.5) {
        const sparkPos = rearCenter.clone().addScaledVector(right, (Math.random() > 0.5 ? 1 : -1) * this.model.dims.width * 0.45);
        sparkPos.y = 0.05;
        particles.spawnBurst(sparkPos, 2, { color: 0xffaa30 });
      }
    }

    // Nitro exhaust flames
    if (this.nitroSpeedMultiplier > 1) {
      for (const side of [-1, 1]) {
        const exhaustPos = rearCenter.clone().addScaledVector(right, side * this.model.dims.width * 0.25);
        particles.spawnFlame(exhaustPos, forward);
      }
    }
  }

  getSnapshot() {
    return {
      x: this.body.position.x,
      y: this.body.position.y,
      z: this.body.position.z,
      qx: this.body.quaternion.x,
      qy: this.body.quaternion.y,
      qz: this.body.quaternion.z,
      qw: this.body.quaternion.w,
      hp: this.hp,
      speed: this.speedKmh,
      shielded: this.effects.shieldCharges > 0,
      ramActive: this.ramMultiplier > 1,
      nitroActive: this.nitroSpeedMultiplier > 1,
      empActive: this.isEmpDisabled,
    };
  }

  private syncMesh() {
    this.model.group.position.set(
      this.body.position.x,
      this.body.position.y + this.suspensionOffset,
      this.body.position.z,
    );
    this.model.group.quaternion.set(
      this.body.quaternion.x,
      this.body.quaternion.y,
      this.body.quaternion.z,
      this.body.quaternion.w,
    );
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    for (const wheel of this.model.wheels) {
      wheel.rotation.z -= speed * 0.13;
    }
  }
}
