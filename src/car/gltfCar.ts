import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_DIMENSIONS, type CarModel } from './carModel';

const loader = new GLTFLoader();
const cache = new Map<string, THREE.Group>();

/**
 * Loads a glTF car (e.g. the CC0 Khronos ToyCar) and normalizes it to the game's physics
 * footprint: auto-scaled to the standard car length, longest horizontal axis rotated onto X
 * (the game's forward axis), and grounded at y=0. Returns the standard CarModel shape;
 * `wheels` stays empty — skinned/foreign models don't expose our wheel convention, and the
 * contact shadow plus motion sells the roll anyway.
 */
export async function loadGltfCar(url: string): Promise<CarModel> {
  let template = cache.get(url);
  if (!template) {
    const gltf = await loader.loadAsync(url);
    template = gltf.scene;
    cache.set(url, template);
  }
  const scene = template.clone(true);

  // Showcase assets often ship with display props (the Khronos ToyCar sits on a draped table) —
  // strip anything that is clearly staging, not car.
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    const meshName = obj.name.toLowerCase();
    const matName = obj instanceof THREE.Mesh && !Array.isArray(obj.material) ? (obj.material.name ?? '').toLowerCase() : '';
    if (/fabric|cloth|table|drape|podium|plinth|base_|display/.test(meshName) || /fabric|cloth|velvet/.test(matName)) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) obj.parent?.remove(obj);

  // Normalize: longest horizontal extent becomes X.
  let box = new THREE.Box3().setFromObject(scene);
  let size = box.getSize(new THREE.Vector3());
  if (size.z > size.x) {
    scene.rotation.y = Math.PI / 2;
    scene.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scene);
    size = box.getSize(new THREE.Vector3());
  }
  const scale = CAR_DIMENSIONS.length / size.x;
  scene.scale.setScalar(scale);
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);

  const group = new THREE.Group();
  scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  group.add(scene);

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Same soft contact blob the procedural cars get.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(CAR_DIMENSIONS.length * 1.15, CAR_DIMENSIONS.width * 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  return { group, wheels: [], dims: CAR_DIMENSIONS };
}
