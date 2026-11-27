import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Course,
  type GameEvent,
  type GameState,
  type Input,
  makeCourse,
  newGame,
  safeSpeed,
  score,
  speedLimitKmh,
  step,
  type VehicleId,
  VEHICLES,
} from "../game/engine";
import { draw } from "../game/render";
import { buildRoutes, type GameRoute } from "../game/routes";
import { useI18n } from "../i18n/core";
import { RoutePreview } from "./RoutePreview";
import { VehicleCarousel } from "./VehicleCarousel";
import type { CameraCondition } from "../types";

interface Props {
  cameras: CameraCondition[]; // live data, or the snapshot from the last live load
  dataTime: string | null;
  live: boolean; // true: today's live data; false: offline with the last data
  near: { lat: number; lon: number } | null; // viewer's position, if shared
  night: boolean;
  onClose: () => void;
}

const BEST_KEY = "keli.game.best";
const VEHICLE_KEY = "keli.game.vehicle";
const ICONS: Record<VehicleId, string> = { car: "🚗", suv: "🚙", van: "🚐", race: "🏎️", bus: "🚌", truck: "🚛" };
const KEYS: Record<string, keyof Input | "left" | "right"> = {
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  ArrowUp: "throttle", w: "throttle", W: "throttle",
  ArrowDown: "brake", s: "brake", S: "brake",
}; // prettier-ignore

function savedVehicle(): VehicleId {
  const v = localStorage.getItem(VEHICLE_KEY);
  return v && v in VEHICLES ? (v as VehicleId) : "car";
}

/** Drive a real road with its real surfaces: online with today's data, or offline. */
export function DriveGame({ cameras, dataTime, live, near, night, onClose }: Props) {
  const { t, num, clock } = useI18n();
  const routes = useMemo(() => buildRoutes(cameras, 4, near), [cameras, near]);
  const [vehicle, setVehicle] = useState<VehicleId>(savedVehicle);
  const [route, setRoute] = useState<GameRoute | null>(null);
  const [picked, setPicked] = useState<GameRoute | null>(null);
  const accent = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7cc4ff", []);
  const [result, setResult] = useState<{ state: GameState; course: Course } | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Start fetching three.js and the vehicle models while the player picks a route.
  useEffect(() => {
    import("../game/three/models").then((m) => m.preloadModels()).catch(() => undefined);
  }, []);

  const pickVehicle = (v: VehicleId) => {
    localStorage.setItem(VEHICLE_KEY, v);
    setVehicle(v);
  };
  const best = Number(localStorage.getItem(BEST_KEY) ?? 0);
  const start = (r: GameRoute) => {
    setResult(null);
    setRoute(r);
    setRunKey((k) => k + 1);
  };
  const shownPick = picked ?? routes[0] ?? null;

  return createPortal(
    <div className="game-backdrop" role="dialog" aria-modal="true" aria-label={t(live ? "game.titleLive" : "game.title")}>
      <div className="game glass">
        <header className="game-head">
          <div>
            <h3>
              {ICONS[vehicle]} {t(live ? "game.titleLive" : "game.title")}
            </h3>
            <p className="muted">{t(live ? "game.subtitleLive" : "game.subtitle", { time: dataTime ? clock(dataTime) : "—" })}</p>
          </div>
          <button className="close static" aria-label={t("drawer.close")} onClick={onClose}>
            ✕
          </button>
        </header>

        {!route && (
          <div className="game-menu setup">
            <p>{t(live ? "game.introLive" : "game.intro")}</p>
            <div className="setup-grid">
              <section>
                <h2>{t("game.vehicle")}</h2>
                <VehicleCarousel value={vehicle} onChange={pickVehicle} accent={accent} />
              </section>
              <section>
                <h2>{t(near ? "game.routesNear" : "game.routes")}</h2>
                {shownPick && <RoutePreview route={shownPick} />}
                {routes.length === 0 && <p className="muted">{t("game.noRoutes")}</p>}
                <ul className="routes" role="radiogroup" aria-label={t("game.routes")}>
                  {routes.map((r) => (
                    <li key={r.id}>
                      <button role="radio" aria-checked={r.id === shownPick?.id} className={r.id === shownPick?.id ? "on" : ""} onClick={() => setPicked(r)}>
                        <span className="route-title">
                          <b>{t(`game.scenario.${r.scenario}`)}</b>
                          <span className="muted">
                            {r.road}
                            {r.distanceKm !== undefined && near ? ` · ${t("game.fromYou", { km: r.distanceKm })}` : ""}
                          </span>
                        </span>
                        <span className="route-places" title={`${r.from} → ${r.to}`}>
                          {r.from} → {r.to}
                        </span>
                        <span className="route-strip" aria-label={t("game.hazards", { n: r.hazards, total: r.stops.length })}>
                          {r.stops.map((st, i) => (
                            <i key={i} className={`surf-${st.surface}`} style={{ animationDelay: `${i * 60}ms` }} />
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!near && <p className="muted">{t("game.nearHint")}</p>}
              </section>
            </div>
            <div className="setup-foot">
              <span className="muted">
                {t("game.controls")}
                {best > 0 && ` · ${t("game.best", { score: best })}`}
              </span>
              <button className="start" disabled={!shownPick} onClick={() => shownPick && start(shownPick)}>
                {t("game.start")} ▶
              </button>
            </div>
          </div>
        )}

        {route && !result && (
          <Drive
            key={runKey}
            route={route}
            vehicle={vehicle}
            night={night}
            onDone={(state, course) => {
              const s = score(state, course);
              if (s > best) localStorage.setItem(BEST_KEY, String(s));
              setResult({ state, course });
            }}
          />
        )}

        {route && result && (
          <div className="game-menu">
            <h3>{result.state.status === "finished" ? t("game.arrived", { to: route.to }) : t("game.crashedOut")}</h3>
            <dl className="facts">
              <div><dt>{t("game.score")}</dt><dd>{score(result.state, result.course)}</dd></div>
              <div><dt>{t("game.time")}</dt><dd>{num(result.state.t, " s")}</dd></div>
              <div><dt>{t("game.slips")}</dt><dd>{result.state.slips}</dd></div>
              <div><dt>{t("game.crashes")}</dt><dd>{result.state.crashes}</dd></div>
            </dl>
            <p className="note">{t(result.state.slips > 3 ? "game.tipSlow" : "game.tipGood")}</p>
            <div className="game-actions">
              <button className="chip glass" onClick={() => { setResult(null); setRunKey((k) => k + 1); }}>{t("game.again")}</button>
              <button className="chip glass" onClick={() => { setRoute(null); setResult(null); }}>{t("game.otherRoute")}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The play screen: canvas, HUD and touch controls. */
function Drive({ route, vehicle, night, onDone }: { route: GameRoute; vehicle: VehicleId; night: boolean; onDone: (s: GameState, c: Course) => void }) {
  const { t, tk, num } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const layer = useRef<import("../game/three/layer").VehicleLayer | null>(null);
  const input = useRef<Input>({ steer: 0, throttle: false, brake: false });
  const held = useRef({ left: false, right: false });
  const course = useMemo(
    () => makeCourse(route.stops.map((s) => ({ surface: s.surface, place: s.place, roadTempC: s.roadTempC, turnDeg: s.turnDeg })), 650, route.id.length * 97),
    [route],
  );
  const state = useRef<GameState>(newGame(vehicle));
  const first = route.stops[0];
  const [hud, setHud] = useState({ kmh: 0, progress: 0, lives: 3, surface: first.surface, place: first.place, temp: first.roadTempC, slip: false, ice: false });
  const [banner, setBanner] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  const setKey = useCallback((k: keyof Input | "left" | "right", down: boolean) => {
    if (k === "left" || k === "right") held.current[k] = down;
    else if (k === "throttle" || k === "brake") input.current[k] = down;
    input.current.steer = held.current.left === held.current.right ? 0 : held.current.left ? -1 : 1;
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "p" || e.key === "P") {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
        e.preventDefault();
        return;
      }
      const k = KEYS[e.key];
      if (k) {
        setKey(k, true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYS[e.key];
      if (k) setKey(k, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setKey]);

  // 3D vehicles: three.js loads in its own chunk; until it is ready (or if WebGL is missing)
  // the 2D vehicles are drawn instead.
  useEffect(() => {
    let alive = true;
    import("../game/three/layer")
      .then(async ({ VehicleLayer }) => {
        if (!alive || !overlay.current) return;
        const l = new VehicleLayer(overlay.current);
        await l.ready;
        if (alive) layer.current = l;
        else l.dispose();
      })
      .catch((err: unknown) => console.warn("3D vehicles unavailable, using 2D", err));
    return () => {
      alive = false;
      layer.current?.dispose();
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7cc4ff";
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let bannerTimer = 0;
    const announce = (text: string, ms = 2600) => {
      setBanner(text);
      clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => setBanner(null), ms);
    };
    const onEvents = (events: GameEvent[]) => {
      for (const e of events) {
        if (e.kind === "stretch") {
          const st = e.stretch;
          const label = tk(`class.${st.surface}`, t("game.unknown"));
          const temp = st.roadTempC === null ? "" : t("game.roadTemp", { temp: num(st.roadTempC, " °C") });
          const slippery = st.surface !== "dry" && st.surface !== "unknown";
          const advice = slippery ? t("game.slowTo", { kmh: Math.round(safeSpeed(st.surface, vehicle) * 3.6) }) : "";
          announce(`${st.place}: ${label}${temp}${advice}`);
        } else if (e.kind === "blackIce") announce(t("game.blackIce"), 1400);
        else if (e.kind === "crash") announce(t("game.crash"), 1200);
        else if (e.kind === "offroad") announce(t("game.offroad"), 1200);
        else if (e.kind === "finish" || e.kind === "over") window.setTimeout(() => onDone(state.current, course), 700);
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) onEvents(step(state.current, course, input.current, dt));
      const frameOut = draw(ctx, w, h, state.current, course, { night, accent, vehicles3d: layer.current !== null });
      if (layer.current) {
        layer.current.resize(w, h, dpr);
        layer.current.setNight(night);
        layer.current.render(frameOut.vehicles.map((v) => ({ ...v, pxPerM: frameOut.pxPerM })));
      }
      if (now - hudAt > 100) {
        hudAt = now;
        const s = state.current;
        const st = course.stretches[Math.max(0, s.stretchIndex)];
        setHud({ kmh: Math.round(s.v * 3.6), progress: s.y / course.length, lives: s.lives, surface: st.surface, place: st.place, temp: st.roadTempC, slip: s.slipping > 0, ice: s.onIce });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(bannerTimer);
    };
  }, [course, onDone, t, tk, num, vehicle, night]);

  const press = (k: keyof Input | "left" | "right") => ({
    onPointerDown: (e: PointerEvent) => { e.preventDefault(); setKey(k, true); },
    onPointerUp: () => setKey(k, false),
    onPointerLeave: () => setKey(k, false),
    onPointerCancel: () => setKey(k, false),
  }); // prettier-ignore

  const limit = speedLimitKmh(hud.surface, vehicle);
  return (
    <div className="drive">
      <canvas ref={canvas} className="drive-canvas" aria-label={t("game.canvas", { from: route.from, to: route.to })} />
      <canvas ref={overlay} className="drive-canvas overlay" aria-hidden />
      <div className="hud">
        <div className="hud-row">
          <span className={`hud-speed ${hud.kmh > limit ? "over" : ""}`}>
            {hud.kmh}
            <small> km/h</small>
          </span>
          <span className="limit-sign" title={t("game.limit")} aria-label={t("game.limit")}>
            {limit}
          </span>
          <span className="hud-lives" aria-label={t("game.lives", { n: hud.lives })}>
            {"❤".repeat(Math.max(0, hud.lives))}
          </span>
        </div>
        <div className="hud-progress" aria-label={t("game.progress", { pct: Math.round(hud.progress * 100) })}>
          <div style={{ width: `${hud.progress * 100}%` }} />
          <span>{route.from}</span>
          <span>{route.to}</span>
        </div>
        <div className="hud-surface">
          <i className={`surf-${hud.surface}`} /> {hud.place} · {tk(`class.${hud.surface}`, t("game.unknown"))}
          {hud.temp !== null && ` · ${num(hud.temp, " °C")}`}
        </div>
      </div>
      {(hud.slip || hud.ice) && <div className="slip">{t(hud.ice ? "game.blackIce" : "game.slip")}</div>}
      {banner && <div className="game-banner">{banner}</div>}
      {paused && <div className="game-banner">{t("game.paused")}</div>}
      <div className="pad" aria-hidden>
        <button {...press("left")}>◀</button>
        <button {...press("brake")}>▼</button>
        <button {...press("throttle")}>▲</button>
        <button {...press("right")}>▶</button>
      </div>
    </div>
  );
}

export default DriveGame;
