// Canvas drawing for the drive game. One metres-based scale for everything, so vehicles,
// lanes and patches keep real proportions. Original shapes only, no image assets.
import { centerAt, type Course, type GameState, headingAt, LANE_M, LANES, type Surface, type VehicleId, VEHICLES, stretchAt } from "./engine";

const SURFACE_COLORS: Record<Surface, string> = {
  dry: "#4b5058",
  unknown: "#555a61",
  wet: "#2e3a49",
  slush: "#6e6455",
  snow: "#d5dde6",
  ice_risk: "#7fa6c4",
};
const VISIBLE_M = 44; // metres of road on screen (vertical): close enough to see the vehicle
const VERGE_M = 2.2; // snow bank beside each edge

export interface Scene {
  night: boolean;
  accent: string;
  vehicles3d: boolean; // vehicles drawn by the 3D layer on top; 2D draws only their lights
}

/** Where each vehicle is on screen this frame (for the 3D layer). */
export interface VehicleOnScreen {
  key: string;
  kind: VehicleId;
  variant: number;
  x: number;
  y: number;
  yaw: number;
  color: string;
  braking: boolean;
  me: boolean;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

/** A vehicle seen from above, nose up, centred on (0,0), size in pixels. */
export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  kind: VehicleId,
  w: number,
  h: number,
  color: string,
  braking: boolean,
  lights: boolean,
) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  rr(ctx, -w / 2 + 2, -h / 2 + 3, w, h, w * 0.25);
  const glass = "rgba(18,26,38,0.88)";
  if (kind === "truck") {
    const cab = h * 0.18;
    ctx.fillStyle = "#c9ced6"; // trailer
    rr(ctx, -w / 2, -h / 2 + cab + 2, w, h - cab - 2, 3);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 1; i < 6; i++) ctx.fillRect(-w / 2, -h / 2 + cab + 2 + (i * (h - cab)) / 6, w, 1);
    ctx.fillStyle = color; // cab
    rr(ctx, -w / 2, -h / 2, w, cab, w * 0.18);
    ctx.fillStyle = glass;
    rr(ctx, -w * 0.4, -h / 2 + cab * 0.15, w * 0.8, cab * 0.3, 2);
  } else if (kind === "bus") {
    ctx.fillStyle = color;
    rr(ctx, -w / 2, -h / 2, w, h, w * 0.2);
    ctx.fillStyle = glass;
    rr(ctx, -w * 0.4, -h / 2 + h * 0.02, w * 0.8, h * 0.07, 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; // roof hatches
    rr(ctx, -w * 0.2, -h * 0.15, w * 0.4, h * 0.08, 2);
    rr(ctx, -w * 0.2, h * 0.2, w * 0.4, h * 0.08, 2);
  } else {
    const van = kind === "van";
    ctx.fillStyle = color;
    rr(ctx, -w / 2, -h / 2, w, h, w * (van ? 0.18 : 0.32));
    ctx.fillStyle = glass;
    rr(ctx, -w * 0.4, -h / 2 + h * (van ? 0.1 : 0.2), w * 0.8, h * 0.16, 3);
    if (!van) rr(ctx, -w * 0.38, h * 0.22, w * 0.76, h * 0.12, 3);
    if (kind === "suv") {
      ctx.fillStyle = "rgba(0,0,0,0.35)"; // roof rails
      ctx.fillRect(-w * 0.42, -h * 0.02, 2, h * 0.2);
      ctx.fillRect(w * 0.42 - 2, -h * 0.02, 2, h * 0.2);
    }
  }
  ctx.fillStyle = lights ? "#fff8d0" : "#e9e2b8"; // headlights
  ctx.fillRect(-w * 0.44, -h / 2, w * 0.2, 2.5);
  ctx.fillRect(w * 0.24, -h / 2, w * 0.2, 2.5);
  ctx.fillStyle = braking ? "#ff2d3d" : "#8a1f28"; // tail lights
  ctx.fillRect(-w * 0.44, h / 2 - 2.5, w * 0.2, 2.5);
  ctx.fillRect(w * 0.24, h / 2 - 2.5, w * 0.2, 2.5);
}

const noise = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;

/** Draw one frame. The camera follows the vehicle; the road bends with the real route. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: GameState,
  course: Course,
  scene: Scene,
): { vehicles: VehicleOnScreen[]; pxPerM: number } {
  const px = Math.min(h / VISIBLE_M, w / (LANES * LANE_M + 2 * VERGE_M + 8)); // pixels per metre
  const roadW = LANES * LANE_M * px;
  const carY = h * 0.74;
  const sy = (m: number) => carY - (m - s.y) * px;
  const top = s.y - (h - carY) / px - 6;
  const bottom = s.y + carY / px + 6;
  const here = centerAt(course, s.y);
  // Left road edge on screen at distance m: centred on the vehicle's stretch of road.
  const edge = (m: number) => w / 2 - roadW / 2 + (centerAt(course, m) - here) * px;
  const lx = (m: number, lane: number) => edge(m) + lane * LANE_M * px;
  const STEP = 1.5;

  // Snow-covered landscape with faint drift lines.
  ctx.fillStyle = "#e6edf3";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(170,190,210,0.25)";
  ctx.lineWidth = 1;
  for (let m = Math.floor(top / 7) * 7; m < bottom; m += 7) {
    const r = noise(m);
    ctx.beginPath();
    ctx.moveTo(r * w * 0.4, sy(m));
    ctx.quadraticCurveTo(r * w * 0.4 + 40, sy(m) - 6, r * w * 0.4 + 90, sy(m));
    ctx.moveTo(w - r * w * 0.4, sy(m + 3));
    ctx.quadraticCurveTo(w - r * w * 0.4 - 40, sy(m + 3) - 6, w - r * w * 0.4 - 90, sy(m + 3));
    ctx.stroke();
  }

  // Road strip polygon helper: [from lane a to lane b] between metres m0..m1, following the bend.
  const strip = (m0: number, m1: number, a: number, b: number) => {
    ctx.beginPath();
    for (let m = m0; m <= m1; m += STEP) ctx.lineTo(lx(m, a), sy(m));
    for (let m = m1; m >= m0; m -= STEP) ctx.lineTo(lx(m, b), sy(m));
    ctx.closePath();
    ctx.fill();
  };

  // Snow banks (ploughed, a little greyer) right beside the road.
  ctx.fillStyle = "#d9e2ea";
  const vergeLanes = VERGE_M / LANE_M;
  strip(Math.max(0, top), Math.min(course.length + 40, bottom), -vergeLanes, 0);
  strip(Math.max(0, top), Math.min(course.length + 40, bottom), LANES, LANES + vergeLanes);

  // Road surface per stretch.
  for (const st of course.stretches) {
    const m0 = Math.max(st.from, top);
    const m1 = Math.min(st.to, bottom);
    if (m0 >= m1) continue;
    ctx.fillStyle = SURFACE_COLORS[st.surface];
    strip(m0, m1, 0, LANES);
    for (let m = Math.ceil(m0 / 1.2) * 1.2; m < m1; m += 1.2) {
      const r = noise(m * 7.3);
      const tx = lx(m, r * LANES);
      if (st.surface === "wet") {
        ctx.fillStyle = "rgba(160,200,255,0.16)";
        ctx.fillRect(tx, sy(m), 1.5 * px + r * 2 * px, 1.5);
      } else if (st.surface === "snow" || st.surface === "slush") {
        ctx.fillStyle = st.surface === "snow" ? "rgba(255,255,255,0.9)" : "rgba(60,50,40,0.35)";
        ctx.fillRect(tx, sy(m), 3, 3);
      } else if (st.surface === "ice_risk") {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(tx, sy(m), 2 * px + r * 3 * px, 1.5);
      }
    }
    if (st.surface === "snow" || st.surface === "slush") {
      ctx.fillStyle = "rgba(70,75,85,0.3)"; // wheel tracks
      for (let l = 0; l < LANES; l++) {
        for (const off of [-0.25, 0.25]) strip(m0, m1, l + 0.5 + off - 0.08, l + 0.5 + off + 0.08);
      }
    }
  }

  // Black-ice patches: irregular glossy sheets with cracks and frost sparkles.
  for (const p of course.patches) {
    if (p.y0 > bottom || p.y1 < top) continue;
    const mid = (p.y0 + p.y1) / 2;
    const cx = lx(mid, (p.x0 + p.x1) / 2);
    const cy = sy(mid);
    const rx = ((p.x1 - p.x0) * LANE_M * px) / 2;
    const ry = ((p.y1 - p.y0) * px) / 2;
    const n = 16;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 0.72 + noise(p.seed + i * 3.1) * 0.38;
      pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
    }
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % n];
      if (i === 0) ctx.moveTo((x + nx) / 2, (y + ny) / 2);
      else ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    });
    ctx.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    ctx.closePath();
    const grad = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    grad.addColorStop(0, "rgba(28,44,62,0.62)");
    grad.addColorStop(0.45, "rgba(190,222,245,0.55)");
    grad.addColorStop(0.55, "rgba(235,248,255,0.7)");
    grad.addColorStop(1, "rgba(28,44,62,0.62)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const a = noise(p.seed + k * 7) * Math.PI * 2;
      const len = (0.4 + noise(p.seed + k) * 0.6) * Math.max(rx, ry);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len * 0.5 + 4, cy + Math.sin(a) * len * 0.5);
      ctx.lineTo(cx + Math.cos(a + 0.3) * len, cy + Math.sin(a + 0.3) * len);
      ctx.stroke();
    }
    for (let k = 0; k < 9; k++) {
      const tw = 0.5 + 0.5 * Math.sin(s.t * 3 + k * 1.7 + p.seed);
      ctx.fillStyle = `rgba(255,255,255,${0.25 + tw * 0.7})`;
      ctx.fillRect(cx + (noise(p.seed + k * 5.3) - 0.5) * rx * 1.5, cy + (noise(p.seed + k * 9.1) - 0.5) * ry * 1.5, 2.5, 2.5);
    }
    ctx.restore();
  }

  // Edge lines and lane dashes (3 m dash, 9 m gap), following the bend.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const m0 = Math.max(0, top);
  const m1 = Math.min(course.length, bottom);
  strip(m0, m1, 0.06, 0.1);
  strip(m0, m1, LANES - 0.1, LANES - 0.06);
  for (let m = Math.floor(top / 12) * 12; m < bottom; m += 12) {
    for (let l = 1; l < LANES; l++) strip(Math.max(0, m), Math.min(course.length, m + 3), l - 0.022, l + 0.022);
  }

  // Snow poles (orange/black striped, every 50 m both sides): the classic Finnish winter road.
  for (let m = Math.floor(top / 50) * 50; m < bottom; m += 50) {
    for (const lane of [-0.25, LANES + 0.25]) {
      const x = lx(m, lane);
      const y = sy(m);
      const hgt = 1.4 * px;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? "#1d1d1d" : "#ff7a1a";
        ctx.fillRect(x - 2, y - hgt + (k * hgt) / 4, 4, hgt / 4);
      }
    }
  }

  // Finish line.
  if (course.length > top && course.length < bottom) {
    const sq = (LANES / 18) * LANE_M * px;
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? "#111" : "#fff";
        ctx.fillRect(lx(course.length, 0) + i * sq, sy(course.length) - (j + 1) * sq, sq, sq);
      }
    }
  }

  // Skid marks.
  const meDims = VEHICLES[s.vehicle];
  ctx.fillStyle = "rgba(20,20,25,0.45)";
  for (const p of s.skid) {
    if (p.y < top || p.y > bottom) continue;
    const half = (meDims.widthM / 2 - 0.3) * px;
    ctx.fillRect(lx(p.y, p.x) - half, sy(p.y), 3, 3);
    ctx.fillRect(lx(p.y, p.x) + half, sy(p.y), 3, 3);
  }

  const st = stretchAt(course, s.y);
  if (st.surface === "snow" || st.surface === "slush") {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 110; i++) {
      const fx = (noise(i) * w + s.t * 15 * (noise(i + 1) - 0.5)) % w;
      const fyy = (noise(i + 2) * h + s.t * (40 + noise(i + 3) * 60) + s.y * px * 0.2) % h;
      ctx.fillRect(fx, fyy, 2.5, 2.5);
    }
  }

  // Vehicles sit along the road and turn with it (road heading plus any slide).
  const slide = Math.max(-0.5, Math.min(0.5, s.vx * 0.25 + (s.slipping > 0 ? Math.sin(s.t * 40) * 0.07 : 0)));
  const vehicles: VehicleOnScreen[] = [
    ...s.traffic.map((c) => ({
      key: `t${c.id}`,
      kind: c.kind,
      variant: c.id,
      x: lx(c.y, c.lane),
      y: sy(c.y),
      yaw: headingAt(course, c.y),
      color: c.color,
      braking: c.speed < 10,
      me: false,
    })),
    { key: "me", kind: s.vehicle, variant: 0, x: lx(s.y, s.x), y: carY, yaw: headingAt(course, s.y) + slide, color: scene.accent, braking: s.braking, me: true },
  ];

  if (scene.night) {
    ctx.fillStyle = "rgba(4,7,16,0.74)";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const v of vehicles) {
      const dims = VEHICLES[v.kind];
      const reach = (v.me ? 30 : 20) * px;
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.yaw);
      for (const side of [-1, 1]) {
        const hx = side * dims.widthM * 0.32 * px;
        const nose = (-dims.lengthM / 2) * px;
        const grad = ctx.createLinearGradient(0, nose, 0, nose - reach);
        grad.addColorStop(0, `rgba(255,240,205,${v.me ? 0.5 : 0.3})`);
        grad.addColorStop(1, "rgba(255,240,205,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(hx - 0.25 * px, nose);
        ctx.lineTo(hx - 2.4 * px + side * 0.7 * px, nose - reach);
        ctx.lineTo(hx + 2.4 * px + side * 0.7 * px, nose - reach);
        ctx.lineTo(hx + 0.25 * px, nose);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  for (const v of vehicles) {
    if (v.me && s.invulnerable > 0 && Math.floor(s.t * 10) % 2 === 0) continue;
    const dims = VEHICLES[v.kind];
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.yaw);
    if (!scene.vehicles3d) {
      if (scene.night) ctx.filter = "brightness(0.72)";
      drawVehicle(ctx, v.kind, dims.widthM * px, dims.lengthM * px, v.color, v.braking, scene.night);
      ctx.filter = "none";
    } else if (v.me) {
      // Mark the player's vehicle under the 3D model: a soft accent halo.
      const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, dims.lengthM * 0.75 * px);
      halo.addColorStop(0, `${scene.accent}55`);
      halo.addColorStop(1, `${scene.accent}00`);
      ctx.fillStyle = halo;
      ctx.fillRect(-dims.lengthM * px, -dims.lengthM * px, dims.lengthM * 2 * px, dims.lengthM * 2 * px);
    }
    if (scene.night) {
      ctx.globalCompositeOperation = "lighter";
      const ty = (dims.lengthM / 2) * px;
      const glow = ctx.createRadialGradient(0, ty, 1, 0, ty, 2.2 * px);
      glow.addColorStop(0, v.braking ? "rgba(255,40,50,0.65)" : "rgba(255,40,50,0.28)");
      glow.addColorStop(1, "rgba(255,40,50,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-2.5 * px, ty - 2.2 * px, 5 * px, 4.4 * px);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  ctx.fillStyle = SURFACE_COLORS[st.surface];
  ctx.fillRect(0, h - 5, w, 5);
  return { vehicles, pxPerM: px };
}
