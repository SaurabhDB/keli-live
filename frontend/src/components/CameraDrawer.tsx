import { type KeyboardEvent, type PointerEvent, useEffect, useState } from "react";
import type { Api } from "../lib/api";
import { useI18n } from "../i18n/core";
import { splitName } from "../lib/format";
import type { AppConfig, CameraCondition, HistoryResponse, Streak } from "../types";
import { HistoryChart } from "./HistoryChart";
import { ImageViewer } from "./ImageViewer";
import { Outlook } from "./Outlook";

const WIDTH_KEY = "keli.drawerWidth";
const MIN_WIDTH = 320;
const maxWidth = () => Math.min(960, window.innerWidth * 0.7);
const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, w)));

/** Drag the drawer's left edge to resize it; the width is remembered in localStorage. */
function useDrawerWidth() {
  const [width, setWidth] = useState(() => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 384));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setWidth(clampWidth(window.innerWidth - e.clientX - 16)); // 16 px = drawer's right margin
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
    setWidth((w) => {
      localStorage.setItem(WIDTH_KEY, String(w));
      return w;
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowLeft" ? 24 : e.key === "ArrowRight" ? -24 : 0;
    if (!delta) return;
    setWidth((w) => {
      const next = clampWidth(w + delta);
      localStorage.setItem(WIDTH_KEY, String(next));
      return next;
    });
  };
  return { width, handle: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}

interface Props {
  cfg: AppConfig;
  api: Api;
  camera: CameraCondition;
  at: Date | null;
  onClose: () => void;
}

export function CameraDrawer({ cfg, api, camera, at, onClose }: Props) {
  // The parent keys this component by camera, so state starts fresh for each camera.
  const [preset, setPreset] = useState(0);
  const { width, handle } = useDrawerWidth();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; history: HistoryResponse | null } | null>(null);
  const atKey = at?.getTime() ?? null;
  const requestKey = `${camera.camera_id}@${atKey ?? "live"}`;

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .history(camera.camera_id, cfg.historyHours, atKey === null ? null : new Date(atKey), ctrl.signal)
      .then((history) => setResult({ key: requestKey, history }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setResult({ key: requestKey, history: null });
      });
    return () => ctrl.abort();
  }, [api, camera.camera_id, cfg.historyHours, atKey, requestKey]);

  const current = result?.key === requestKey ? result : null; // ignore a previous camera/time
  const history = current?.history ?? null;
  const historyError = current !== null && history === null;
  // Durations run to the history's last point: "now" when live, the slider time otherwise.
  const lastPoint = history?.points[history.points.length - 1];
  const viewedAt = lastPoint ? new Date(lastPoint.t).getTime() : undefined;

  const { t, tk, num, clock, duration, reason, stationDistance } = useI18n();
  const streakText = (s: Streak, prefix: "class" | "hazard") =>
    s.complete
      ? t("streak.complete", { d: duration(s.since, viewedAt), time: clock(s.since) }) +
        (s.previous ? t("streak.was", { prev: tk(`${prefix}.${s.previous}`).toLowerCase() }) : "")
      : t("streak.incomplete", { d: duration(s.since, viewedAt), time: clock(s.since) });
  const { place, road } = splitName(camera.name);
  const presetId = camera.presets[preset] ?? camera.presets[0];
  const imgFailed = failedImage === presetId;
  const k = camera.road_class;
  const style = k ? cfg.classes[k] : null;
  const tooFar = camera.station_dist_m !== null && camera.station_dist_m > cfg.trainingRadiusM;

  let why: string;
  if (k) {
    why = t("why.measured", { id: camera.station_id ?? "—", distance: stationDistance(camera.station_dist_m) });
    why += camera.source === "optical" ? t("why.optical") : ".";
    if (camera.measured_at) why += t("why.reading", { time: clock(camera.measured_at) });
  } else if (tooFar) {
    why = t("why.tooFar", { km: num(camera.station_dist_m! / 1000) });
  } else {
    why = t("why.noFresh");
  }

  return (
    <aside className="drawer glass" style={{ width }} aria-label={t("drawer.aria", { place })}>
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("drawer.resize")}
        aria-valuenow={width}
        tabIndex={0}
        {...handle}
      />
      <div className="shot">
        {presetId && !imgFailed ? (
          <img
            key={presetId}
            src={`${cfg.imageBase}/${presetId}.jpg`}
            alt={t("drawer.imageAlt", { place })}
            onError={() => setFailedImage(presetId)}
            onClick={() => setViewerOpen(true)}
            title={t("drawer.imageTitle")}
          />
        ) : (
          <div className="noimg">{t("drawer.imageUnavailable")}</div>
        )}
        <div className="shot-fade" />
        <button className="close" aria-label={t("drawer.close")} onClick={onClose}>
          ✕
        </button>
        {camera.presets.length > 1 && (
          <div className="presets" role="tablist">
            {camera.presets.map((p, i) => (
              <button key={p} role="tab" aria-selected={i === preset} className={i === preset ? "on" : ""} onClick={() => setPreset(i)}>
                {t("drawer.view", { n: i + 1 })}
              </button>
            ))}
          </div>
        )}
        {presetId && !imgFailed && (
          <button className="expand" onClick={() => setViewerOpen(true)} aria-label={t("drawer.detailsAria")}>
            {t("drawer.details")}
          </button>
        )}
        <span className="live-badge">{t(at ? "drawer.latestImage" : "drawer.liveImage")}</span>
      </div>

      <div className="body">
        <div>
          <h3>{place}</h3>
          <div className="muted">
            {road && `${road} · `}
            {camera.camera_id}
          </div>
        </div>

        {camera.hazard && (
          <div className="hazard" style={{ ["--c" as string]: cfg.hazards[camera.hazard].color }}>
            <div className="hazard-head">
              <i />
              <b>{tk(`hazard.${camera.hazard}`)}</b>
              <span className="muted">{t("hazard.word")}</span>
            </div>
            {history?.hazard_streak?.value === camera.hazard && (
              <div className="streak">
                ⏱ {streakText(history.hazard_streak, "hazard")}
              </div>
            )}
            {camera.hazard_codes.length > 0 ? (
              <ul>
                {camera.hazard_codes.map((r) => (
                  <li key={r.code}>{reason(r.code, r.params)}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{tk(`hazard.${camera.hazard}.hint`)}</p>
            )}
          </div>
        )}

        <div className="pill" style={{ ["--c" as string]: style?.color ?? cfg.noDataColor }}>
          <i />
          {k ? tk(`class.${k}`) : t("drawer.noLabel")}
          {k && <span className="muted">{tk(`class.${k}.hint`)}</span>}
          {k && history?.surface_streak?.value === k && (
            <span className="streak">
              ⏱ {streakText(history.surface_streak, "class")}
            </span>
          )}
        </div>

        <div className="metrics">
          <div className="metric">
            <b>{num(camera.road_temp_c, "°")}</b>
            <span>{t("drawer.road")}</span>
          </div>
          <div className="metric">
            <b>{num(camera.air_temp_c, "°")}</b>
            <span>{t("drawer.air")}</span>
          </div>
          <div className="metric">
            <b>{num(camera.friction, "", 2)}</b>
            <span>{t("drawer.grip")}</span>
          </div>
        </div>

        {history?.labelled && history.data_source === "database" && (
          <HistoryChart cfg={cfg} points={history.points} hours={cfg.historyHours} />
        )}
        {history?.data_source === "digitraffic_live" && (
          <p className="note warn">{t("history.liveOnly")}</p>
        )}
        {!history && !historyError && !tooFar && <div className="skeleton" />}
        {historyError && <p className="muted">{t("history.unavailable")}</p>}

        <Outlook cfg={cfg} api={api} camera={camera} at={at} />

        <p className="note">{why}</p>
      </div>
      {viewerOpen && (
        <ImageViewer cfg={cfg} camera={camera} preset={preset} onPreset={setPreset} onClose={() => setViewerOpen(false)} />
      )}
    </aside>
  );
}
