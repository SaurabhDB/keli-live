import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/core";
import { splitName } from "../lib/format";
import type { AppConfig, CameraCondition } from "../types";
import { ZoomImage } from "./ZoomImage";

interface Props {
  cfg: AppConfig;
  camera: CameraCondition;
  preset: number;
  onPreset: (i: number) => void;
  onClose: () => void;
}

/** Full-size camera image with every detail we know about the location. */
export function ImageViewer({ cfg, camera, preset, onPreset, onClose }: Props) {
  const { t, tk, num, clock, reason, stationDistance } = useI18n();
  const n = camera.presets.length;
  const presetId = camera.presets[preset];
  const { place, road } = splitName(camera.name);
  const k = camera.road_class;
  const style = k ? cfg.classes[k] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && n > 1) onPreset((preset + 1) % n);
      else if (e.key === "ArrowLeft" && n > 1) onPreset((preset - 1 + n) % n);
      else return;
      e.stopPropagation(); // keep Escape from also closing the drawer
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [n, preset, onPreset, onClose]);

  const rows: [string, string][] = [
    [t("viewer.camera"), t("viewer.cameraValue", { id: camera.camera_id, n: preset + 1, total: n, preset: presetId })],
    [t("viewer.road"), road || "—"],
    [t("viewer.location"), `${num(camera.lat, "", 5)}, ${num(camera.lon, "", 5)}`],
    [t("viewer.station"), camera.station_id !== null ? `${camera.station_id} · ${stationDistance(camera.station_dist_m)}` : "—"],
    [
      t("viewer.hazard"),
      camera.hazard
        ? `${tk(`hazard.${camera.hazard}`)}${camera.hazard_codes.length ? `: ${camera.hazard_codes.map((r) => reason(r.code, r.params)).join("; ")}` : ""}`
        : "—",
    ],
    [
      t("viewer.source"),
      camera.source === "optical" ? t("viewer.optical") : camera.source === "sensor" ? t("viewer.inRoad") : t("map.noSensor"),
    ],
    [t("viewer.roadTemp"), num(camera.road_temp_c, " °C")],
    [t("viewer.air"), num(camera.air_temp_c, " °C")],
    [t("viewer.grip"), num(camera.friction, "", 2)],
    [t("viewer.reading"), camera.measured_at ? clock(camera.measured_at) : "—"],
  ];

  // Portal to <body>: the drawer's backdrop-filter would otherwise become the containing
  // block for this position: fixed overlay and trap it inside the drawer.
  return createPortal(
    <div className="viewer-backdrop" role="dialog" aria-modal="true" aria-label={t("viewer.aria", { place })} onClick={onClose}>
      <div className="viewer glass" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-img">
          {presetId ? (
            <ZoomImage key={presetId} src={`${cfg.imageBase}/${presetId}.jpg`} alt={t("viewer.imageAlt", { place, n: preset + 1 })} downloadName={`keli-${presetId}`} />
          ) : (
            <div className="noimg">{t("drawer.imageUnavailable")}</div>
          )}
          {n > 1 && (
            <>
              <button className="nav prev" aria-label={t("viewer.prev")} onClick={() => onPreset((preset - 1 + n) % n)}>‹</button>
              <button className="nav next" aria-label={t("viewer.next")} onClick={() => onPreset((preset + 1) % n)}>›</button>
            </>
          )}
          <button className="close" aria-label={t("drawer.close")} onClick={onClose}>✕</button>
          <span className="live-badge">● Latest image</span>
        </div>

        <div className="viewer-info">
          <div>
            <h3>{place}</h3>
            <div className="muted">{road || camera.camera_id}</div>
          </div>
          <div className="pill" style={{ ["--c" as string]: style?.color ?? cfg.noDataColor }}>
            <i />
            {k ? tk(`class.${k}`) : t("drawer.noLabel")}
            {k && <span className="muted">{tk(`class.${k}.hint`)}</span>}
          </div>
          <dl className="facts">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {n > 1 && (
            <div className="thumbs">
              {camera.presets.map((p, i) => (
                <button key={p} className={i === preset ? "on" : ""} onClick={() => onPreset(i)} aria-label={t("drawer.view", { n: i + 1 })}>
                  <img src={`${cfg.imageBase}/${p}.jpg?thumbnail=true`} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <div className="links">
            <a href={`https://www.openstreetmap.org/?mlat=${camera.lat}&mlon=${camera.lon}#map=14/${camera.lat}/${camera.lon}`} target="_blank" rel="noreferrer">
              {t("viewer.osm")}
            </a>
          </div>
          <p className="muted">{t("viewer.credit")}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
