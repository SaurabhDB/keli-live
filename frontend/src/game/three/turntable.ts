// The vehicle picker's 3D preview: the chosen model slowly turning on a snowy disc.
import * as THREE from "three";
import type { VehicleId } from "../engine";
import { makeVehicle, preloadModels } from "./models";

export class Turntable {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private holder = new THREE.Group();
  private raf = 0;
  private current: VehicleId | null = null;
  private appearAt = 0;
  ready: Promise<void>;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 11, 0.4, 48),
      new THREE.MeshStandardMaterial({ color: 0xe6edf3, roughness: 0.95 }),
    );
    disc.position.y = -0.2;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-8, 14, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4), sun, disc, this.holder);
    this.ready = preloadModels();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Show a vehicle; the camera frames it by length (a 16.5 m lorry vs a 4.5 m car). */
  async show(kind: VehicleId, color: string) {
    this.current = kind;
    const made = await makeVehicle(kind, 0, color);
    if (this.current !== kind) return; // the choice changed while loading
    this.holder.clear();
    this.holder.add(made.root);
    const box = new THREE.Box3().setFromObject(made.root);
    const len = box.getSize(new THREE.Vector3()).length();
    this.camera.position.set(0, len * 0.55, len * 1.35);
    this.camera.lookAt(0, len * 0.08, 0);
    this.appearAt = performance.now();
  }

  private frame(now: number) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const k = Math.min(1, (now - this.appearAt) / 400);
    this.holder.scale.setScalar(0.6 + 0.4 * (1 - (1 - k) ** 3)); // pop in on change
    this.holder.rotation.y = now / 2600;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
