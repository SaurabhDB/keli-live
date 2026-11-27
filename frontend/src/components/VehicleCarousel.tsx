import { useEffect, useRef, useState } from "react";
import { type VehicleId, VEHICLES } from "../game/engine";
import { drawVehicle } from "../game/render";
import { useI18n } from "../i18n/core";

interface Props {
  value: VehicleId;
  onChange: (v: VehicleId) => void;
  accent: string;
}

const IDS = Object.keys(VEHICLES) as VehicleId[];
const maxOf = (k: "accel" | "brake" | "maxV") => Math.max(...IDS.map((id) => VEHICLES[id][k]));

/** One vehicle at a time: an animated preview driving on a short road, arrows to switch. */
export function VehicleCarousel({ value, onChange, accent }: Props) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvas3d = useRef<HTMLCanvasElement>(null);
  const table = useRef<import("../game/three/turntable").Turntable | null>(null);
  const [has3d, setHas3d] = useState(false);
  const shown = useRef({ id: value, since: 0, from: value }); // since 0: no slide-in on first paint
  const i = IDS.indexOf(value);
  const go = (d: number) => onChange(IDS[(i + d + IDS.length) % IDS.length]);

  useEffect(() => {
    shown.current = { id: value, since: performance.now(), from: shown.current.id };
    void table.current?.show(value, accent);
  }, [value, accent]);

  // 3D turntable once three.js and the models have loaded; the 2D preview shows until then.
  const firstValue = useRef(value);
  useEffect(() => {
    let alive = true;
    import("../game/three/turntable")
      .then(async ({ Turntable }) => {
        if (!alive || !canvas3d.current) return;
        const tt = new Turntable(canvas3d.current);
        await tt.ready;
        if (!alive) return tt.dispose();
        table.current = tt;
        await tt.show(firstValue.current, accent);
        if (alive) setHas3d(true);
      })
      .catch((err: unknown) => console.warn("3D preview unavailable", err));
    return () => {
      alive = false;
      table.current?.dispose();
      table.current = null;
    };
  }, [accent]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const px = h / 20; // the 16.5 m truck still fits
      const roadW = 3.5 * 2 * px;
      ctx.fillStyle = "#e3eaf1";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4b5058";
      ctx.fillRect((w - roadW) / 2, 0, roadW, h);
      // Scrolling centre dashes make the preview feel like it is driving.
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const offset = ((now / 1000) * 12 * px) % (12 * px);
      for (let y = -12 * px + offset; y < h; y += 12 * px) ctx.fillRect(w / 2 - 1.5, y, 3, 3 * px);
      // Slide the new vehicle up from below when the choice changes.
      const { id, since } = shown.current;
      const k = Math.min(1, (now - since) / 350);
      const ease = 1 - (1 - k) ** 3;
      const v = VEHICLES[id];
      const bob = Math.sin(now / 260) * 1.2;
      ctx.save();
      ctx.translate(w / 2 + 3.5 * 0.5 * px, h / 2 + (1 - ease) * h * 0.7 + bob);
      drawVehicle(ctx, id, v.widthM * px, v.lengthM * px, accent, false, false);
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [accent]);

  const v = VEHICLES[value];
  const bars: [string, number][] = [
    [t("game.stat.accel"), v.accel / maxOf("accel")],
    [t("game.stat.brake"), v.brake / maxOf("brake")],
    [t("game.stat.top"), v.maxV / maxOf("maxV")],
  ];
  return (
    <div
      className="carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={t("game.vehicle")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <div className="carousel-stage">
        <button className="carousel-nav" aria-label={t("viewer.prev")} onClick={() => go(-1)}>‹</button>
        <div className="carousel-view">
          <canvas ref={canvas} className={`carousel-canvas ${has3d ? "hidden" : ""}`} aria-hidden />
          <canvas ref={canvas3d} className={`carousel-canvas three ${has3d ? "" : "hidden"}`} aria-hidden />
        </div>
        <button className="carousel-nav" aria-label={t("viewer.next")} onClick={() => go(1)}>›</button>
      </div>
      <div className="carousel-info" aria-live="polite">
        <b>{t(`game.v.${value}`)}</b>
        <span className="muted">{t(`game.v.${value}.hint`)}</span>
        {bars.map(([label, val]) => (
          <span className="stat" key={label}>
            <span>{label}</span>
            <i style={{ width: `${Math.round(val * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="carousel-dots" role="tablist">
        {IDS.map((id) => (
          <button key={id} role="tab" aria-selected={id === value} aria-label={t(`game.v.${id}`)} className={id === value ? "on" : ""} onClick={() => onChange(id)} />
        ))}
      </div>
    </div>
  );
}
