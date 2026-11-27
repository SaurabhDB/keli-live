import { type MouseEvent, useState } from "react";
import { useI18n } from "../i18n/core";
import type { AppConfig, HistoryPoint } from "../types";

interface Props {
  cfg: AppConfig;
  points: HistoryPoint[];
  hours: number;
}

const W = 344;
const H = 156;
const PAD_L = 30;
const PAD_R = 6;
const TOP = 10;
const PLOT_H = 92;
const STRIP_Y = TOP + PLOT_H + 10;
const STRIP_H = 8;

/** Road temperature (one series: the title names it, no legend box) over a condition strip. */
export function HistoryChart({ cfg, points, hours }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const { t, tk, clock, num } = useI18n();
  if (!points.length) return <p className="muted">{t("history.none")}</p>;

  const temps = points.map((p) => p.road_temp_c).filter((t): t is number => t !== null);
  const lo = Math.floor(Math.min(0, ...temps) - 1);
  const hi = Math.ceil(Math.max(0, ...temps) + 1);
  const span = W - PAD_L - PAD_R;
  const x = (i: number) => PAD_L + (i / Math.max(1, points.length - 1)) * span;
  const y = (t: number) => TOP + ((hi - t) / (hi - lo)) * PLOT_H;
  const yTicks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const step = span / Math.max(1, points.length - 1);

  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.road_temp_c === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.road_temp_c).toFixed(1)}`;
    pen = true;
  });

  // Consecutive points of one class become one strip segment.
  const runs: { k: HistoryPoint["road_class"]; start: number; end: number }[] = [];
  points.forEach((p, i) => {
    const last = runs[runs.length - 1];
    if (last && last.k === p.road_class) last.end = i;
    else runs.push({ k: p.road_class, start: i, end: i });
  });

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((vx - PAD_L) / span) * (points.length - 1)))));
  };
  const hp = hover === null ? null : points[hover];
  const timeIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="chart">
      <div className="chart-head">
        <h2>{t("history.title", { h: hours })}</h2>
        <span className="muted">
          {hp ? `${clock(hp.t)} · ${hp.road_class ? tk(`class.${hp.road_class}`) : t("history.noLabel")} · ${num(hp.road_temp_c, " °C")}` : t("history.hint")}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("history.aria", { h: hours })}>
        <g className="grid">
          {yTicks.map((t) => (
            <line key={t} x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {yTicks.map((t) => (
            <text key={t} x={PAD_L - 6} y={y(t) + 3} textAnchor="end">
              {t}°
            </text>
          ))}
          {timeIdx.map((i, j) => (
            <text key={i} x={x(i)} y={STRIP_Y + STRIP_H + 14} textAnchor={(["start", "middle", "end"] as const)[j]}>
              {clock(points[i].t)}
            </text>
          ))}
        </g>
        <line className="zero" x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} />
        <path className="temp" d={d} />
        {runs.map((r) =>
          r.k ? (
            <rect
              key={r.start}
              x={x(r.start) - step / 2}
              y={STRIP_Y}
              width={Math.max(1, (r.end - r.start + 1) * step - 2)}
              height={STRIP_H}
              rx={2}
              fill={cfg.classes[r.k].color}
            />
          ) : null,
        )}
        {hp && hover !== null && (
          <g>
            <line className="cross" x1={x(hover)} x2={x(hover)} y1={TOP} y2={STRIP_Y + STRIP_H} />
            {hp.road_temp_c !== null && <circle className="dot" cx={x(hover)} cy={y(hp.road_temp_c)} r={4} />}
          </g>
        )}
        <rect x={PAD_L} y={0} width={span} height={H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
    </div>
  );
}
