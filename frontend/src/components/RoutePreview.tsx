import type { GameRoute } from "../game/routes";
import { useI18n } from "../i18n/core";

const COLORS: Record<string, string> = {
  dry: "#3fb68b",
  wet: "#4aa3ff",
  slush: "#e0a526",
  snow: "#c3cfe2",
  ice_risk: "#ff5a6e",
  unknown: "#6b7689",
};
const W = 360;
const H = 210;
const PAD = 26;

/** The real route through its cameras, coloured by surface, drawn in as it appears. */
export function RoutePreview({ route }: { route: GameRoute }) {
  const { t, tk } = useI18n();
  const cos = Math.cos((route.stops[0].lat * Math.PI) / 180);
  const xs = route.stops.map((s) => s.lon * cos);
  const ys = route.stops.map((s) => s.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * PAD) / Math.max(1e-6, x1 - x0), (H - 2 * PAD) / Math.max(1e-6, y1 - y0));
  const ox = (W - (x1 - x0) * scale) / 2;
  const oy = (H - (y1 - y0) * scale) / 2;
  const pts = route.stops.map((_, i) => [ox + (xs[i] - x0) * scale, H - (oy + (ys[i] - y0) * scale)] as const);
  const km = Math.round(
    route.stops.slice(1).reduce((sum, s, i) => {
      const a = route.stops[i];
      return sum + Math.hypot((s.lon - a.lon) * cos, s.lat - a.lat) * 111.2;
    }, 0),
  );
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lens.reduce((n, l) => n + l, 0) || 1;
  // Each segment starts drawing when the previous ones are done: one stroke along the route.
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((n, l) => n + l, 0));
  const segs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: lens[i], delay: (starts[i] / total) * 0.9, color: COLORS[route.stops[i].surface] }));

  return (
    <figure className="route-preview" key={route.id}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("game.preview", { from: route.from, to: route.to, km })}>
        <polyline className="route-casing" points={pts.map((p) => p.join(",")).join(" ")} />
        {segs.map((sg, i) => {
          const { len, delay } = sg;
          return (
            <line
              key={i}
              x1={sg.a[0]}
              y1={sg.a[1]}
              x2={sg.b[0]}
              y2={sg.b[1]}
              stroke={sg.color}
              className="route-seg"
              style={{ strokeDasharray: len, strokeDashoffset: len, animationDelay: `${delay}s` }}
            >
              <title>{`${route.stops[i].place}: ${tk(`class.${route.stops[i].surface}`, t("game.unknown"))}`}</title>
            </line>
          );
        })}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 || i === pts.length - 1 ? 6 : 3.2} className={i === 0 ? "pt start" : i === pts.length - 1 ? "pt end" : "pt"} />
        ))}
        <text x={pts[0][0]} y={pts[0][1] - 11} className="pt-label" textAnchor="middle">
          {route.from}
        </text>
        <text x={pts[pts.length - 1][0]} y={pts[pts.length - 1][1] + 20} className="pt-label" textAnchor="middle">
          {route.to}
        </text>
      </svg>
      <figcaption className="muted">
        {route.road} · {t("game.routeKm", { km })} · {t("game.hazards", { n: route.hazards, total: route.stops.length })}
      </figcaption>
    </figure>
  );
}
