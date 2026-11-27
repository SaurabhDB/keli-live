import { useMemo, useState } from "react";
import { useI18n } from "../i18n/core";
import { splitName } from "../lib/format";
import { legendFor } from "../lib/view";
import type { AppConfig, CameraCondition, ConditionsResponse, HealthResponse, View } from "../types";

interface Props {
  cfg: AppConfig;
  data: ConditionsResponse | null;
  health: HealthResponse | null;
  apiDown: boolean;
  at: Date | null;
  view: View;
  hidden: Set<string>;
  showStations: boolean;
  showUnlabelled: boolean;
  onView: (v: View) => void;
  onToggleClass: (k: string) => void;
  onShowStations: (v: boolean) => void;
  showMaintenance: boolean;
  onShowMaintenance: (v: boolean) => void;
  onShowUnlabelled: (v: boolean) => void;
  onPick: (c: CameraCondition) => void;
}

function Status({ health, apiDown, at }: Pick<Props, "health" | "apiDown" | "at">) {
  const { t, dayClock, ago } = useI18n();
  if (at) return <div className="status"><span className="dot past" />{t("status.viewing", { time: dayClock(at) })}</div>;
  if (apiDown) return <div className="status"><span className="dot down" />{t("status.apiDown")}</div>;
  if (!health) return <div className="status"><span className="dot" />{t("status.connecting")}</div>;
  if (health.status === "degraded") {
    return (
      <div className="status">
        <span className="dot stale" />
        {t("status.degraded")}
      </div>
    );
  }
  const ok = health.status === "ok";
  return (
    <div className="status">
      <span className={`dot ${ok ? "live" : "stale"}`} />
      {health.newest_reading_at
        ? t(ok ? "status.live" : "status.stale", { ago: ago(health.newest_reading_at) })
        : t("status.noData")}
    </div>
  );
}

export function Sidebar(p: Props) {
  const { cfg, data } = p;
  const { t, tk, num } = useI18n();
  const [query, setQuery] = useState("");
  const legend = useMemo(() => legendFor(cfg, p.view), [cfg, p.view]);
  const { order, styles } = legend;

  const summary = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
    for (const c of data?.cameras ?? []) {
      const v = legend.valueOf(c);
      if (v) counts[v] = (counts[v] ?? 0) + 1;
    }
    const labelled = order.reduce((n, k) => n + counts[k], 0);
    const high = (data?.cameras ?? []).filter((c) => c.hazard === "high").length;
    const temps = (data?.stations ?? []).map((s) => s.road_temp_c).filter((t): t is number => t !== null);
    return { counts, labelled, high, total: data?.cameras.length ?? 0, stations: data?.stations.length ?? 0, coldest: temps.length ? Math.min(...temps) : null };
  }, [data, order, legend]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return [];
    return data.cameras.filter((c) => c.name.toLowerCase().replace(/_/g, " ").includes(q)).slice(0, 8);
  }, [query, data]);

  const high = summary.high;
  return (
    <aside className="panel glass">
      <header className="brand">
        <div className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5" />
          </svg>
        </div>
        <div>
          <h1>Keli Live</h1>
          <p className="tagline">{t("app.tagline")}</p>
        </div>
      </header>

      <Status health={p.health} apiDown={p.apiDown} at={p.at} />

      <section className="kpis" aria-live="polite">
        <div className={`kpi ${high ? "alert" : ""}`}>
          <b>{high}</b>
          <span>{t("kpi.high")}</span>
        </div>
        <div className="kpi">
          <b>
            {summary.labelled}
            <small> / {summary.total}</small>
          </b>
          <span>{t("kpi.labelled")}</span>
        </div>
        <div className="kpi">
          <b>{summary.stations}</b>
          <span>{t("kpi.stations")}</span>
        </div>
        <div className="kpi">
          <b>{num(summary.coldest, "°")}</b>
          <span>{t("kpi.coldest")}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="segmented" role="radiogroup" aria-label={t("view.aria")}>
            {(["hazard", "surface"] as const).map((v) => (
              <button key={v} role="radio" aria-checked={p.view === v} className={p.view === v ? "on" : ""} onClick={() => p.onView(v)}>
                {t(v === "hazard" ? "view.hazard" : "view.surface")}
              </button>
            ))}
          </div>
          <span className="muted">{t("legend.filter")}</span>
        </div>
        <div className="stackbar" role="img" aria-label={order.map((k) => `${tk(`${legend.prefix}.${k}`)} ${summary.counts[k]}`).join(", ")}>
          {order
            .filter((k) => summary.counts[k] && !p.hidden.has(k))
            .map((k) => (
              <div key={k} style={{ flexGrow: summary.counts[k], background: styles[k].color }} title={`${tk(`${legend.prefix}.${k}`)}: ${summary.counts[k]}`} />
            ))}
        </div>
        <ul className="classes">
          {order.map((k) => (
            <li key={k}>
              <button className={p.hidden.has(k) ? "off" : ""} onClick={() => p.onToggleClass(k)} aria-pressed={!p.hidden.has(k)}>
                <span className="sw" style={{ background: styles[k].color }} />
                <span className="txt">
                  {tk(`${legend.prefix}.${k}`)}
                  <small>{tk(`${legend.prefix}.${k}.hint`, "")}</small>
                </span>
                <b>{summary.counts[k]}</b>
              </button>
            </li>
          ))}
          <li>
            <button className={p.showUnlabelled ? "" : "off"} onClick={() => p.onShowUnlabelled(!p.showUnlabelled)} aria-pressed={p.showUnlabelled}>
              <span className="sw ring" style={{ color: cfg.noDataColor }} />
              <span className="txt">
                {t("legend.none")}
                <small>{t("legend.noneHint")}</small>
              </span>
              <b>{summary.total - summary.labelled}</b>
            </button>
          </li>
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t("search.title")}</h2>
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.aria")} />
        {query.trim() && (
          <ul className="results">
            {hits.length ? (
              hits.map((c) => {
                const { place, road } = splitName(c.name);
                const v = legend.valueOf(c);
                return (
                  <li key={c.camera_id}>
                    <button onClick={() => p.onPick(c)}>
                      <span className="sw" style={{ background: v ? styles[v].color : cfg.noDataColor }} />
                      {place} <span className="muted">{road}</span>
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="muted">{t("search.none", { q: query })}</li>
            )}
          </ul>
        )}
      </section>

      <section className="card layers">
        <label>
          <input type="checkbox" checked={p.showStations} onChange={(e) => p.onShowStations(e.target.checked)} /> {t("layer.stations")}
        </label>
        <label>
          <input type="checkbox" checked={p.showMaintenance} onChange={(e) => p.onShowMaintenance(e.target.checked)} />{" "}
          {t("layer.maintenance", { h: cfg.maintenance.layerHours })}
        </label>
        {p.showMaintenance && (
          <div className="task-legend">
            {[...new Map(Object.entries(cfg.maintenance.tasks).map(([k, s]) => [tk(`task.${k}`), s.color])).entries()].map(([label, color]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        )}
      </section>

      <footer className="attribution">
        {data?.attribution ?? "Source: Fintraffic / digitraffic.fi, license CC BY 4.0"}. {t("footer.note")}
      </footer>
    </aside>
  );
}
