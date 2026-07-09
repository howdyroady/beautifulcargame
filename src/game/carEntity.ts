import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel, type CarModel } from '../car/carModel';
import { createCarBody, applyCarControl, DEFAULT_CAR_CONFIG } from '../physics/carPhysics';
import { computeComebackBuff } from './comeback';
import type { CarInput } from '../input/input';

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
  private lastHitAt = 0;
  matchTime = 0;

  constructor(scene: THREE.Scene, world: CANNON.World, carMaterial: CANNON.Material, color: number, spawn: CANNON.Vec3, facing: number) {
    this.model = createCarModel(color);
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
        this.effects.empUntil = now + 2; // applied to the *opponent* by caller
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

  /** Returns true if the hit was absorbed by a shield instead of dealing damage. */
  takeDamage(amount: number, now: number): boolean {
    if (now - this.lastHitAt < 0.35) return true; // brief i-frame to avoid multi-tick damage while pushing
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

  update(dt: number, input: CarInput, terrainEffect: { friction: number; boostX: number; boostZ: number }) {
    this.matchTime += dt;
    const comeback = computeComebackBuff(this.hp, MAX_HP);
    const speedMult = comeback.speedMultiplier * this.nitroSpeedMultiplier * terrainEffect.friction;
    const effectiveInput: CarInput = this.isEmpDisabled ? { throttle: input.throttle * 0.3, steer: input.steer * -0.4, brake: input.brake } : input;

    applyCarControl(this.body, effectiveInput, dt, DEFAULT_CAR_CONFIG, speedMult, comeback.handlingMultiplier);

    if (terrainEffect.boostX !== 0 || terrainEffect.boostZ !== 0) {
      this.body.applyForce(new CANNON.Vec3(terrainEffect.boostX * 40, 0, terrainEffect.boostZ * 40), new CANNON.Vec3());
    }

    this.syncMesh();
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
      shielded: this.effects.shieldCharges > 0,
      ramActive: this.ramMultiplier > 1,
      nitroActive: this.nitroSpeedMultiplier > 1,
      empActive: this.isEmpDisabled,
    };
  }

  private syncMesh() {
    this.model.group.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.model.group.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    for (const wheel of this.model.wheels) {
      wheel.rotation.x += speed * 0.12;
    }
  }
}
