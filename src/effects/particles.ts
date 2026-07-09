import * as THREE from 'three';

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  baseOpacity: number;
  growth: number;
  active: boolean;
}

function buildSoftDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export interface SpawnOptions {
  life?: number;
  size?: number;
  color?: number;
  growth?: number;
  opacity?: number;
  additive?: boolean;
}

/** Fixed-size pool of camera-facing sprites used for smoke/spark/nitro particles — no per-frame allocation. */
export class ParticlePool {
  private particles: Particle[] = [];
  private texture = buildSoftDotTexture();

  constructor(scene: THREE.Scene, maxParticles = 90) {
    for (let i = 0; i < maxParticles; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.userData.persistent = true;
      scene.add(sprite);
      this.particles.push({ sprite, velocity: new THREE.Vector3(), life: 0, maxLife: 1, baseOpacity: 0.6, growth: 0, active: false });
    }
  }

  spawn(position: THREE.Vector3, velocity: THREE.Vector3, opts: SpawnOptions = {}) {
    const p = this.particles.find((particle) => !particle.active);
    if (!p) return;
    p.active = true;
    p.life = p.maxLife = opts.life ?? 0.6;
    p.velocity.copy(velocity);
    p.growth = opts.growth ?? 0.3;
    p.baseOpacity = opts.opacity ?? 0.6;
    p.sprite.position.copy(position);
    p.sprite.scale.setScalar(opts.size ?? 0.4);
    p.sprite.visible = true;
    const mat = p.sprite.material as THREE.SpriteMaterial;
    mat.color.set(opts.color ?? 0xffffff);
    mat.opacity = p.baseOpacity;
    mat.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  update(dt: number) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.velocity.y += -0.6 * dt;
      p.sprite.scale.addScalar(p.growth * dt);
      const t = Math.max(0, p.life / p.maxLife);
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.baseOpacity * t;
    }
  }
}
