// "Drive" game: pure simulation, no DOM. Top-down 3-lane road in metres; each stretch has the
// real surface of a camera from the loaded data. Vehicle physics and grip shape steering,
// braking and slips; ice-risk stretches carry black-ice patches.

export type Surface = "dry" | "wet" | "slush" | "snow" | "ice_risk" | "unknown";
export type VehicleId = "car" | "suv" | "van" | "race" | "bus" | "truck";

/** Tyre grip per surface (0..1): rough real-world friction coefficients, tuned for play. */
export const GRIP: Record<Surface, number> = {
  dry: 1.0,
  unknown: 0.85,
  wet: 0.75,
  slush: 0.5,
  snow: 0.42,
  ice_risk: 0.22,
};
export const BLACK_ICE_GRIP = 0.08;

export const LANES = 3;
export const LANE_M = 3.5; // Finnish main-road lane width

export interface Vehicle {
  lengthM: number;
  widthM: number;
  accel: number; // m/s² on full grip
  brake: number; // m/s² on full grip
  maxV: number; // m/s
  steer: number; // lanes/s at full grip and speed
  traction: number; // multiplies grip for acceleration only (4x4 pulls away better)
  winterGrip: number; // tyre factor on every surface but dry (slicks are hopeless on ice)
  limitKmh: number; // legal top speed for this vehicle class in Finland
}

export const VEHICLES: Record<VehicleId, Vehicle> = {
  car: { lengthM: 4.6, widthM: 1.8, accel: 7, brake: 10, maxV: 34, steer: 2.6, traction: 1, winterGrip: 1, limitKmh: 120 },
  suv: { lengthM: 4.9, widthM: 1.95, accel: 7.5, brake: 9.5, maxV: 33, steer: 2.4, traction: 1.35, winterGrip: 1, limitKmh: 120 },
  van: { lengthM: 5.6, widthM: 2.0, accel: 5.5, brake: 8.5, maxV: 31, steer: 2.2, traction: 1, winterGrip: 1, limitKmh: 100 },
  race: { lengthM: 4.5, widthM: 1.95, accel: 10, brake: 12, maxV: 50, steer: 3.1, traction: 0.8, winterGrip: 0.55, limitKmh: 120 },
  bus: { lengthM: 12.5, widthM: 2.55, accel: 4.4, brake: 7.5, maxV: 28, steer: 1.7, traction: 1, winterGrip: 1, limitKmh: 100 },
  truck: { lengthM: 16.5, widthM: 2.55, accel: 3.6, brake: 6.8, maxV: 23, steer: 1.5, traction: 0.95, winterGrip: 1, limitKmh: 80 },
};

// Rolling resistance plus air drag (grows with v²), instead of a flat brake on the car.
const ROLLING = 0.15;
const AIR = 0.0045;
// Finnish winter (studded) tyres pull away far better on ice than the bare friction suggests;
// braking still follows the surface grip.
const TRACTION_BOOST = 2.4;
const INVULNERABLE_S = 1.6;

export interface Stretch {
  surface: Surface;
  place: string;
  roadTempC: number | null;
  from: number; // metres along the route
  to: number;
}

/** A black-ice patch: lanes [x0, x1] across, metres [y0, y1] along. */
export interface Patch {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  seed: number; // shape of the drawn outline
}

export interface Traffic {
  id: number;
  kind: VehicleId;
  lane: number; // lane centre 0.5, 1.5, 2.5
  y: number;
  speed: number;
  color: string;
}

export interface Input {
  steer: -1 | 0 | 1;
  throttle: boolean;
  brake: boolean;
}

export type GameEvent =
  | { kind: "stretch"; stretch: Stretch }
  | { kind: "slip" }
  | { kind: "blackIce" }
  | { kind: "crash" }
  | { kind: "offroad" }
  | { kind: "finish" }
  | { kind: "over" };

export interface GameState {
  vehicle: VehicleId;
  x: number; // lateral position in lanes, 0..LANES
  vx: number; // lanes per second
  y: number; // metres along the route
  v: number; // m/s
  t: number;
  lives: number;
  slips: number;
  crashes: number;
  invulnerable: number;
  slipping: number; // seconds of slip effect left
  onIce: boolean;
  braking: boolean;
  stretchIndex: number;
  lastPatch: number; // index of the last black-ice patch announced
  traffic: Traffic[];
  nextTrafficId: number;
  status: "running" | "finished" | "over";
  skid: { x: number; y: number }[];
}

export interface Course {
  stretches: Stretch[];
  patches: Patch[];
  length: number;
  /** Per metre along the route: curvature (1/m, + = bending right) and the road centre's
   * sideways offset (m) from a straight line. Sampled every metre. */
  curvature: Float32Array;
  center: Float32Array;
  heading: Float32Array; // radians, + = pointing right
}

/** A stretch as given to ``makeCourse``; ``turnDeg`` is the real heading change at its camera. */
export type StretchInput = Omit<Stretch, "from" | "to"> & { turnDeg?: number };

const MAX_BEND_RAD = 0.6; // ~35°: steep enough to feel, gentle enough for a top-down view

/** Small deterministic random, so a route always has the same ice patches. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Lay out stretches of ``stretchM`` metres; ice-risk stretches get 4-7 black-ice patches. */
export function makeCourse(items: StretchInput[], stretchM = 650, seed = 7): Course {
  const rand = seeded(seed);
  const stretches = items.map(({ turnDeg: _turn, ...s }, i) => ({ ...s, from: i * stretchM, to: (i + 1) * stretchM }));
  const patches: Patch[] = [];
  for (const st of stretches) {
    if (st.surface !== "ice_risk") continue;
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const y0 = st.from + 60 + rand() * (stretchM - 120);
      // Irregular sizes: small spots, lane-wide sheets, and some that cross two lanes.
      const width = 0.6 + rand() * 1.9;
      const x0 = rand() * (LANES - width);
      patches.push({ x0, x1: x0 + width, y0, y1: y0 + 5 + rand() * 14, seed: Math.floor(rand() * 1e6) });
    }
  }
  const length = stretches.length * stretchM;
  return { stretches, patches, length, ...bends(items, stretchM, length, rand) };
}

/**
 * Road geometry: every stretch is an S-free bend in and out (heading 0 at both ends), its size
 * and direction from the real turn at that camera, so the road weaves like the real one.
 */
function bends(items: StretchInput[], stretchM: number, length: number, rand: () => number) {
  const n = Math.ceil(length) + 1;
  const curvature = new Float32Array(n);
  const heading = new Float32Array(n);
  const center = new Float32Array(n);
  items.forEach((it, i) => {
    const turn = it.turnDeg ?? (rand() - 0.5) * 30;
    // turnDeg 0 = straight (route ends, tests); otherwise at least a gentle 8° bend.
    const amp = turn === 0 ? 0 : Math.sign(turn) * Math.min(MAX_BEND_RAD, ((Math.abs(turn) * 0.8 + 8) * Math.PI) / 180);
    for (let m = 0; m < stretchM; m++) {
      const y = i * stretchM + m;
      if (y >= n) break;
      // heading = amp * sin(pi * t): enters and leaves the stretch pointing straight ahead.
      heading[y] = amp * Math.sin((Math.PI * m) / stretchM);
      curvature[y] = ((amp * Math.PI) / stretchM) * Math.cos((Math.PI * m) / stretchM);
    }
  });
  for (let y = 1; y < n; y++) center[y] = center[y - 1] + Math.sin(heading[y - 1]);
  return { curvature, center, heading };
}

const sample = (arr: Float32Array, y: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(y)))];
export const curvatureAt = (c: Course, y: number) => sample(c.curvature, y);
export const centerAt = (c: Course, y: number) => sample(c.center, y);
export const headingAt = (c: Course, y: number) => sample(c.heading, y);

export function newGame(vehicle: VehicleId = "car"): GameState {
  return {
    vehicle,
    x: 1.5,
    vx: 0,
    y: 0,
    v: 0,
    t: 0,
    lives: 3,
    slips: 0,
    crashes: 0,
    invulnerable: 0,
    slipping: 0,
    onIce: false,
    braking: false,
    stretchIndex: -1,
    lastPatch: -1,
    traffic: [],
    nextTrafficId: 1,
    status: "running",
    skid: [],
  };
}

export function stretchAt(course: Course, y: number): Stretch {
  const per = course.length / course.stretches.length;
  return course.stretches[Math.min(course.stretches.length - 1, Math.max(0, Math.floor(y / per)))];
}

/** Advised speed on a surface (m/s): lower grip, lower speed; never above the vehicle's limit. */
export function safeSpeed(surface: Surface, vehicle: VehicleId = "car"): number {
  return Math.min(VEHICLES[vehicle].limitKmh / 3.6, 34 * Math.sqrt(GRIP[surface]) * 0.85);
}

/** Posted speed limit for a stretch (km/h): Finnish winter limits drop on slippery roads. */
export function speedLimitKmh(surface: Surface, vehicle: VehicleId): number {
  const road = surface === "dry" || surface === "unknown" ? 100 : surface === "wet" ? 100 : 80;
  return Math.min(road, VEHICLES[vehicle].limitKmh);
}

function patchIndexAt(course: Course, x: number, y: number): number {
  return course.patches.findIndex((p) => y >= p.y0 && y <= p.y1 && x >= p.x0 && x <= p.x1);
}

const TRAFFIC_KINDS: VehicleId[] = ["car", "car", "car", "car", "suv", "van", "bus", "truck", "truck"]; // no race cars in traffic
const CAR_COLORS = ["#e8edf6", "#ffb347", "#7cc4ff", "#c3a6ff", "#9be38f", "#ff8a8a", "#2b2f36"];

/**
 * Advance the game by ``dt`` seconds. ``rand`` is injectable for tests. Returns events for
 * the HUD (new stretch, slip, black ice, crash, finish).
 */
export function step(s: GameState, course: Course, input: Input, dt: number, rand: () => number = Math.random): GameEvent[] {
  if (s.status !== "running") return [];
  const events: GameEvent[] = [];
  const car = VEHICLES[s.vehicle];
  const stretch = stretchAt(course, s.y);
  const idx = course.stretches.indexOf(stretch);
  if (idx !== s.stretchIndex) {
    s.stretchIndex = idx;
    events.push({ kind: "stretch", stretch });
  }

  const patch = patchIndexAt(course, s.x, s.y);
  s.onIce = patch >= 0;
  if (patch >= 0 && patch !== s.lastPatch) {
    s.lastPatch = patch;
    events.push({ kind: "blackIce" });
  }
  const tyre = stretch.surface === "dry" ? 1 : car.winterGrip;
  const grip = (s.onIce ? BLACK_ICE_GRIP : GRIP[stretch.surface]) * tyre;

  // Longitudinal: grip limits acceleration (wheel spin; 4x4 helps) and braking (it does not).
  let a = -(ROLLING + AIR * s.v * s.v);
  if (input.throttle) a += car.accel * Math.min(1, grip * TRACTION_BOOST * car.traction);
  if (input.brake) a -= car.brake * grip;
  s.braking = input.brake;
  s.v = Math.max(0, Math.min(car.maxV, s.v + a * dt));

  // Lateral: eases towards the steering target at a rate set by grip, so on ice the vehicle
  // answers late and keeps sliding after the key is released.
  const speedFactor = Math.min(1, s.v / 12);
  const target = input.steer * car.steer * speedFactor;
  s.vx += (target - s.vx) * Math.min(1, grip * 7 * dt);

  // Curves: the vehicle drifts outward (v² · curvature). Grip absorbs it quickly on a dry
  // road; on ice it lingers, and above the grip limit the vehicle slides off the bend.
  const k = curvatureAt(course, s.y);
  const lateral = s.v * s.v * k; // m/s², + = pushed left (outward on a right bend)
  const limit = grip * 9.81 * 0.55;
  const beyond = Math.max(0, Math.abs(lateral) / limit - 1);
  s.vx -= (lateral / LANE_M) * (0.45 + beyond * 2.5) * dt;
  if (beyond > 0 && rand() < beyond * 2 * dt) {
    s.slips += 1;
    s.slipping = 0.8;
    events.push({ kind: "slip" });
  }

  // Too fast for the surface (or on black ice at speed): a chance per second to slip.
  const over = s.v / safeSpeed(stretch.surface, s.vehicle) - 1 + (s.onIce ? s.v / 15 : 0);
  if (over > 0 && rand() < over * 1.6 * dt) {
    s.vx += (rand() < 0.5 ? -1 : 1) * (0.9 + over * 2) * (1 - grip);
    s.slips += 1;
    s.slipping = 0.8;
    events.push({ kind: "slip" });
  }
  s.slipping = Math.max(0, s.slipping - dt);
  if (s.slipping > 0 || (s.onIce && s.v > 8)) s.skid.push({ x: s.x, y: s.y });
  if (s.skid.length > 500) s.skid.splice(0, s.skid.length - 500);

  s.x += s.vx * dt;
  s.y += s.v * dt;
  s.t += dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);

  // Road edge (into the snow bank).
  const half = car.widthM / 2 / LANE_M;
  if (s.x < half || s.x > LANES - half) {
    s.x = Math.min(LANES - half, Math.max(half, s.x));
    s.vx = -s.vx * 0.3;
    if (s.v > 8 && s.invulnerable === 0) hit(s, events, "offroad");
    else s.v *= 0.97;
  }

  updateTraffic(s, course, dt, rand);
  for (const other of s.traffic) {
    const o = VEHICLES[other.kind];
    const hitX = (car.widthM + o.widthM) / 2 / LANE_M - 0.05;
    const hitY = (car.lengthM + o.lengthM) / 2;
    if (s.invulnerable === 0 && Math.abs(other.lane - s.x) < hitX && Math.abs(other.y - s.y) < hitY) {
      s.traffic = s.traffic.filter((c) => c !== other);
      hit(s, events, "crash");
      break;
    }
  }

  if (s.lives <= 0) {
    s.status = "over";
    events.push({ kind: "over" });
  } else if (s.y >= course.length) {
    s.y = course.length;
    s.status = "finished";
    events.push({ kind: "finish" });
  }
  return events;
}

function hit(s: GameState, events: GameEvent[], kind: "crash" | "offroad") {
  s.lives -= 1;
  s.crashes += 1;
  s.v *= 0.3;
  s.invulnerable = INVULNERABLE_S;
  events.push({ kind });
}

function updateTraffic(s: GameState, course: Course, dt: number, rand: () => number) {
  for (const c of s.traffic) {
    // Other drivers slow down for the surface too.
    const limit = safeSpeed(stretchAt(course, c.y).surface, c.kind) * 0.95;
    c.speed += (Math.min(c.speed, limit) - c.speed) * Math.min(1, dt);
    c.y += c.speed * dt;
  }
  s.traffic = s.traffic.filter((c) => c.y > s.y - 60 && c.y < s.y + 320);
  // Keep a few vehicles ahead; never block every lane, so there is always a way through.
  const ahead = s.traffic.filter((c) => c.y > s.y + 60).length;
  if (ahead < 4 && s.y + 260 < course.length && rand() < 1.3 * dt) {
    const lane = Math.floor(rand() * LANES) + 0.5;
    const y = s.y + 230 + rand() * 60;
    const blocked = s.traffic.filter((c) => Math.abs(c.y - y) < 30).map((c) => c.lane);
    if (!blocked.includes(lane) && blocked.length < LANES - 1) {
      const kind = TRAFFIC_KINDS[Math.floor(rand() * TRAFFIC_KINDS.length)];
      const cruise = Math.min(VEHICLES[kind].maxV, 14 + rand() * 9);
      s.traffic.push({ id: s.nextTrafficId++, kind, lane, y, speed: cruise, color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)] });
    }
  }
}

/** Points: faster is better; crashes and slips cost; heavier vehicles get a handicap bonus. */
export function score(s: GameState, course: Course): number {
  if (s.status !== "finished") return 0;
  const par = course.length / (VEHICLES[s.vehicle].maxV * 0.6);
  const time = Math.max(0, Math.round(5000 * (par / Math.max(s.t, 1))));
  return Math.max(0, time + s.lives * 1000 - s.slips * 150);
}
