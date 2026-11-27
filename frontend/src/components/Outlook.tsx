import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import { useI18n } from "../i18n/core";
import { taskStyle } from "../lib/format";
import type { AppConfig, CameraCondition, OutlookResponse } from "../types";

interface Props {
  cfg: AppConfig;
  api: Api;
  camera: CameraCondition;
  at: Date | null;
}

const POOR = new Set(["POOR_CONDITION", "EXTREMELY_POOR_CONDITION"]);

/** Winter maintenance near the camera and the road weather forecast for its road section. */
export function Outlook({ cfg, api, camera, at }: Props) {
  const { t, tk, ago, clock, num } = useI18n();
  const atKey = at?.getTime() ?? null;
  const requestKey = `${camera.camera_id}@${atKey ?? "live"}`;
  const [result, setResult] = useState<{ key: string; data: OutlookResponse | null } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .outlook(camera.camera_id, atKey === null ? null : new Date(atKey), ctrl.signal)
      .then((data) => setResult({ key: requestKey, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setResult({ key: requestKey, data: null });
      });
    return () => ctrl.abort();
  }, [api, camera.camera_id, atKey, requestKey]);

  const data = result?.key === requestKey ? result.data : undefined; // undefined = loading
  const word = (code: string | null) => (code ? tk(`fc.${code}`, code) : "—");
  const recent = data?.treatments ?? [];

  return (
    <>
      <section className="treated">
        <h2>{t("outlook.maintenance")}</h2>
        {data === undefined ? (
          <div className="skeleton short" />
        ) : recent.length ? (
          <ul>
            {recent.slice(0, 4).map((m) => {
              const style = taskStyle(m.tasks, cfg.maintenance.tasks);
              return (
                <li key={`${m.end_time}-${m.tasks.join()}`}>
                  <i style={{ background: style?.color ?? cfg.noDataColor }} />
                  <b>{style ? tk(`task.${style.key}`) : m.tasks.join(", ")}</b>
                  <span>{ago(m.end_time)}</span>
                  <span className="muted">{t("outlook.away", { m: m.dist_m })}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t("outlook.noMaintenance")}</p>
        )}
      </section>

      {data?.forecast && (
        <section className="forecast">
          <div className="chart-head">
            <h2>{t("outlook.forecast")}</h2>
            <span className="muted">{t("outlook.issued", { time: clock(data.forecast.issued_at) })}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t("outlook.colTime")}</th>
                <th>{t("outlook.colRoad")}</th>
                <th>{t("outlook.colSurface")}</th>
                <th>{t("outlook.colDriving")}</th>
              </tr>
            </thead>
            <tbody>
              {data.forecast.items.map((i) => (
                <tr key={i.name} className={i.overall_condition && POOR.has(i.overall_condition) ? "poor" : ""}>
                  <td>
                    {i.kind === "OBSERVATION" ? t("outlook.now") : `+${i.name}`} <span className="muted">{clock(i.valid_at)}</span>
                  </td>
                  <td>{num(i.road_temp_c, "°")}</td>
                  <td>{word(i.road_condition)}</td>
                  <td>{word(i.overall_condition)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            {t("outlook.source", { section: data.forecast.description, m: data.forecast.dist_m })}
          </p>
        </section>
      )}
      {data && !data.forecast && data.data_source === "database" && (
        <p className="muted">{t("outlook.noSection")}</p>
      )}
    </>
  );
}
