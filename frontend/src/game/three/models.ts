// 3D vehicles: Kenney "Car Kit" models (CC0, public/models/kenney) plus a bus and a European
// articulated lorry built here from simple shapes (the kit has neither). Everything is sized in metres to
// the game's vehicle dimensions and faces -Z ("up" on the top-down screen).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type VehicleId, VEHICLES } from "../engine";

const BASE = "/models/kenney/";
// Kenney models face +Z; the game drives towards -Z.
const MODEL_YAW = Math.PI;

/** Which model file each vehicle uses; traffic picks a variant for variety. */
export const MODEL_FILES: Record<VehicleId, string[]> = {
  car: ["sedan", "hatchback-sports", "sedan-sports", "taxi"],
  suv: ["suv", "suv-luxury"],
  van: ["van"],
  race: ["race", "race-future"],
  bus: [],
  truck: [],
};

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

function loadModel(name: string): Promise<THREE.Object3D> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${BASE}${name}.glb`).then((g) => {
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  return p;
}

/** Load every model the game can show, in parallel; resolves when all are ready. */
export function preloadModels(): Promise<void> {
  const names = new Set(Object.values(MODEL_FILES).flat());
  return Promise.all([...names].map(loadModel)).then(() => undefined);
}

/** Scale an object so its footprint is exactly width x length metres (height kept natural). */
function fitTo(obj: THREE.Object3D, widthM: number, lengthM: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
  const holder = new THREE.Group();
  holder.add(obj);
  const sx = widthM / size.x;
  const sz = lengthM / size.z;
  holder.scale.set(sx, (sx + sz) / 2, sz);
  const out = new THREE.Group();
  out.add(holder);
  return out;
}

function box(w: number, h: number, l: number, color: number | string, y = h / 2, z = 0, emissive = false): THREE.Mesh {
  const mat = emissive
    ? new THREE.MeshBasicMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(0, y, z);
  return m;
}

function wheels(group: THREE.Group, widthM: number, axlesZ: number[]) {
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9 });
  for (const z of axlesZ) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(geo, mat);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * (widthM / 2 - 0.1), 0.5, z);
      group.add(w);
    }
  }
}

/** A city bus: long body, window band, roof units. Built here (the kit has no bus). */
function buildBus(color: string): THREE.Group {
  const { widthM: w, lengthM: l } = VEHICLES.bus;
  const g = new THREE.Group();
  g.add(box(w, 2.6, l, color, 1.75));
  g.add(box(w + 0.02, 0.9, l - 1.2, 0x1c2633, 2.3, 0.3)); // side windows
  g.add(box(w - 0.2, 0.9, 0.08, 0x1c2633, 2.2, -l / 2)); // windscreen
  g.add(box(w * 0.6, 0.3, 2.2, 0xd7dde5, 3.2, -l * 0.18)); // roof units
  g.add(box(w * 0.6, 0.3, 1.6, 0xd7dde5, 3.2, l * 0.25));
  wheels(g, w, [-l / 2 + 2.6, l / 2 - 3]);
  return g;
}

/** Flat-shaded material in the kit's low-poly style. */
function mat(color: number | string, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15, flatShading: true });
}

function part(g: THREE.Group, w: number, h: number, l: number, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), material);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** Wheel with a lighter hub, axle across X, tucked under the body. */
function wheel(g: THREE.Group, x: number, z: number, r = 0.52) {
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.38, 16), mat(0x17191d, 0.95));
  tyre.rotation.z = Math.PI / 2;
  tyre.position.set(x, r, z);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.4, 10), mat(0xb9c0c8, 0.4));
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x + Math.sign(x) * 0.01, r, z);
  g.add(tyre, hub);
}

/**
 * European articulated lorry (cab-over tractor + 13.6 m box semi-trailer), the kind on every
 * Finnish main road. Built from simple shapes; nose at -Z, total length = VEHICLES.truck.
 */
function buildTruck(cabColor = "#c8323c"): THREE.Group {
  const { widthM: w, lengthM: l } = VEHICLES.truck;
  const g = new THREE.Group();
  const front = -l / 2;
  const glass = mat(0x18222e, 0.2);
  const dark = mat(0x23262b, 0.8);
  const steel = mat(0x9aa3ad, 0.4);
  const cab = mat(cabColor, 0.45);

  // Tractor unit: 6 m long; cab over the front axle.
  const tractorLen = 6.0;
  part(g, w * 0.86, 0.35, tractorLen - 0.4, dark, 0, 0.95, front + tractorLen / 2 + 0.2); // chassis rails
  const cabLen = 2.3;
  const cabZ = front + cabLen / 2 + 0.15;
  part(g, w, 2.35, cabLen, cab, 0, 2.3, cabZ); // cab body (1.1 .. 3.5 m)
  part(g, w - 0.1, 0.9, 0.06, glass, 0, 2.75, front + 0.12); // windscreen
  part(g, 0.05, 0.75, 1.1, glass, w / 2 + 0.005, 2.75, cabZ - 0.35); // side windows
  part(g, 0.05, 0.75, 1.1, glass, -w / 2 - 0.005, 2.75, cabZ - 0.35);
  part(g, w - 0.3, 0.55, 1.6, cab, 0, 3.75, cabZ + 0.2).rotation.x = -0.18; // roof air deflector
  part(g, w * 0.7, 0.55, 0.08, dark, 0, 1.6, front + 0.13); // grille
  part(g, w + 0.06, 0.32, 0.25, steel, 0, 0.95, front + 0.12); // bumper
  for (const side of [-1, 1]) {
    part(g, 0.4, 0.16, 0.06, mat(0xfff3c4, 0.2), side * (w / 2 - 0.35), 1.25, front + 0.1); // headlights
    part(g, 0.08, 0.45, 0.25, dark, side * (w / 2 + 0.22), 2.9, front + 0.45); // mirrors
    part(g, 0.08, 0.5, 0.6, steel, side * (w / 2 - 0.02), 1.2, cabZ + 0.4); // steps
  }
  part(g, 0.55, 0.55, 1.2, steel, w / 2 - 0.3, 1.0, front + 3.2); // fuel tank
  part(g, 0.55, 0.55, 0.9, dark, -w / 2 + 0.3, 1.0, front + 3.1); // battery box
  part(g, 1.6, 0.12, 1.4, dark, 0, 1.18, front + 4.7); // fifth-wheel plate
  for (const z of [front + 1.3, front + 4.3, front + 5.6]) {
    wheel(g, w / 2 - 0.3, z);
    wheel(g, -(w / 2 - 0.3), z);
  }

  // Semi-trailer: 13.6 m box (1.25 .. 4.0 m), front edge over the tractor's drive axles.
  const trailerLen = 13.6;
  const tz = l / 2 - trailerLen / 2;
  const body = mat(0xeef1f5, 0.5);
  part(g, w, 2.75, trailerLen, body, 0, 2.62, tz);
  part(g, w + 0.02, 0.32, trailerLen - 0.3, mat(0x2f6fd0, 0.45), 0, 1.75, tz); // stripe
  part(g, w + 0.02, 0.06, trailerLen, mat(0xc9ced6, 0.5), 0, 4.0, tz); // roof edge
  part(g, w * 0.86, 0.3, trailerLen - 1, dark, 0, 1.12, tz + 0.3); // chassis
  for (const side of [-1, 1]) {
    part(g, 0.05, 0.1, 6.5, steel, side * (w / 2 - 0.05), 0.75, tz - 1.2); // side guard rails
    part(g, 0.12, 0.9, 0.12, steel, side * 0.8, 0.6, tz - trailerLen / 2 + 3.4); // landing legs
  }
  part(g, w - 0.1, 2.5, 0.05, mat(0xd3d8de, 0.5), 0, 2.62, l / 2 + 0.01); // rear doors
  part(g, 0.04, 2.5, 0.06, dark, 0, 2.62, l / 2 + 0.03); // door seam
  part(g, w + 0.04, 0.2, 0.22, dark, 0, 0.75, l / 2 - 0.1); // under-run bar
  for (const z of [l / 2 - 1.4, l / 2 - 2.75, l / 2 - 4.1]) {
    wheel(g, w / 2 - 0.3, z);
    wheel(g, -(w / 2 - 0.3), z);
  }
  return g;
}

/** Red tail lights at the rear; their material is switched on while braking. */
function addTailLights(g: THREE.Group, widthM: number, lengthM: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7a1a22 });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(widthM * 0.22, 0.25, 0.08), mat);
    m.position.set(side * widthM * 0.3, 0.9, lengthM / 2 + 0.02);
    g.add(m);
  }
  return mat;
}

export interface Vehicle3D {
  root: THREE.Group;
  tailLights: THREE.MeshBasicMaterial;
}

/** A ready-to-place vehicle (call ``preloadModels`` first). ``variant`` picks a model. */
export async function makeVehicle(kind: VehicleId, variant = 0, color = "#3a73c4"): Promise<Vehicle3D> {
  const dims = VEHICLES[kind];
  let body: THREE.Group;
  if (kind === "bus") body = buildBus(color);
  else if (kind === "truck") body = buildTruck();
  else {
    const files = MODEL_FILES[kind];
    const model = (await loadModel(files[variant % files.length])).clone();
    model.rotation.y = MODEL_YAW;
    body = fitTo(model, dims.widthM, dims.lengthM);
  }
  const root = new THREE.Group();
  root.add(body);
  const tailLights = addTailLights(root, dims.widthM, dims.lengthM);
  return { root, tailLights };
}
