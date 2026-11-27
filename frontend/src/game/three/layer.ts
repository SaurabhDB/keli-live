// Draws the game's vehicles in 3D on a transparent canvas over the 2D road. Top-down
// orthographic camera with one unit = one screen pixel, so positions come straight from
// the 2D renderer and nothing else in the game changes.
import * as THREE from "three";
import type { VehicleId } from "../engine";
import { makeVehicle, preloadModels, type Vehicle3D } from "./models";

export interface Placed {
  key: string; // stable per vehicle (traffic id, or "me")
  kind: VehicleId;
  variant: number;
  x: number; // screen px
  y: number;
  yaw: number; // canvas rotation (clockwise +)
  pxPerM: number;
  braking: boolean;
  color: string;
}

export class VehicleLayer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 5000);
  private ambient = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.8);
  private live = new Map<string, Vehicle3D | "loading">();
  private w = 0;
  private h = 0;
  ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Light from the upper left and above, so roofs and sides read as 3D from the top.
    this.sun.position.set(-600, 1200, -500);
    this.scene.add(this.ambient, this.sun, this.sun.target);
    this.ready = preloadModels();
  }

  /** Match the overlay to the 2D canvas size (CSS px) and pixel ratio. */
  resize(w: number, h: number, dpr: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    // Looking straight down; screen x = world x, screen y = world z.
    Object.assign(this.camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    this.camera.position.set(w / 2, 2000, h / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(w / 2, 0, h / 2);
    this.camera.updateProjectionMatrix();
    this.sun.target.position.set(w / 2, 0, h / 2);
  }

  setNight(night: boolean) {
    this.ambient.intensity = night ? 0.45 : 1.6;
    this.sun.intensity = night ? 0.25 : 1.8;
  }

  /** Place this frame's vehicles; models load once and are reused across frames. */
  render(list: Placed[]) {
    const seen = new Set<string>();
    for (const v of list) {
      seen.add(v.key);
      const entry = this.live.get(v.key);
      if (entry === undefined) {
        this.live.set(v.key, "loading");
        makeVehicle(v.kind, v.variant, v.color).then((made) => {
          if (this.live.get(v.key) === "loading") {
            this.live.set(v.key, made);
            this.scene.add(made.root);
          }
        });
        continue;
      }
      if (entry === "loading") continue;
      entry.root.position.set(v.x, 0, v.y);
      entry.root.rotation.y = -v.yaw;
      entry.root.scale.setScalar(v.pxPerM);
      entry.tailLights.color.set(v.braking ? 0xff2233 : 0x7a1a22);
    }
    for (const [key, entry] of this.live) {
      if (seen.has(key)) continue;
      if (entry !== "loading") this.scene.remove(entry.root);
      this.live.delete(key);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.live.clear();
  }
}
