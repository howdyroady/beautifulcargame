import type { Circuit } from '../track/circuit';

const SIZE = 132;
const PAD = 12;

/**
 * Corner minimap: the track outline is rasterized once to an offscreen canvas, per-frame work
 * is just blitting it and drawing one dot per car.
 */
export class Minimap {
  root: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private toMap: (x: number, z: number) => [number, number];

  constructor(container: HTMLElement, circuit: Circuit) {
    this.root = document.createElement('canvas');
    this.root.width = SIZE;
    this.root.height = SIZE;
    this.root.className = 'minimap';
    container.appendChild(this.root);
    this.ctx = this.root.getContext('2d')!;

    // Fit the curve's bounding box into the canvas.
    const pts: [number, number][] = [];
    for (let i = 0; i < 96; i++) {
      const p = circuit.curve.getPointAt(i / 96);
      pts.push([p.x, p.z]);
    }
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.toMap = (x, z) => [
      PAD + (x - minX) * scale + ((SIZE - PAD * 2) - (maxX - minX) * scale) / 2,
      PAD + (z - minZ) * scale + ((SIZE - PAD * 2) - (maxZ - minZ) * scale) / 2,
    ];

    this.base = document.createElement('canvas');
    this.base.width = SIZE;
    this.base.height = SIZE;
    const bctx = this.base.getContext('2d')!;
    bctx.fillStyle = 'rgba(8, 10, 16, 0.55)';
    bctx.beginPath();
    bctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    bctx.fill();
    bctx.strokeStyle = 'rgba(255,255,255,0.75)';
    bctx.lineWidth = 4;
    bctx.lineJoin = 'round';
    bctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [mx, mz] = this.toMap(x, z);
      if (i === 0) bctx.moveTo(mx, mz);
      else bctx.lineTo(mx, mz);
    });
    bctx.closePath();
    bctx.stroke();
    // Start/finish tick.
    const [sx, sz] = this.toMap(pts[0][0], pts[0][1]);
    bctx.fillStyle = '#ff4a3c';
    bctx.fillRect(sx - 3, sz - 3, 6, 6);
  }

  update(cars: { x: number; z: number; color: string }[]) {
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(this.base, 0, 0);
    for (const car of cars) {
      const [mx, mz] = this.toMap(car.x, car.z);
      this.ctx.fillStyle = car.color;
      this.ctx.beginPath();
      this.ctx.arc(mx, mz, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  destroy() {
    this.root.remove();
  }
}
