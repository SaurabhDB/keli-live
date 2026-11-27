import { useI18n } from "../i18n/core";
import { type PointerEvent as ReactPointerEvent, type WheelEvent, useCallback, useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  downloadName: string;
}

interface View {
  s: number; // scale: screen px per image px
  x: number; // image origin in stage px
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_ZOOM = 1; // relative to "fit"
const MAX_ZOOM = 8;
const STEP = 1.4;

/**
 * Image with zoom (buttons, wheel, double-click), drag-to-pan, and crop: drag a box to
 * zoom into it and save that region as a JPEG. Digitraffic serves images with CORS `*`,
 * so the canvas export is allowed.
 */
export function ZoomImage({ src, alt, downloadName }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<View>({ s: 1, x: 0, y: 0 });
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [cropMode, setCropMode] = useState(false);
  const [box, setBox] = useState<Rect | null>(null); // crop box in stage px while dragging
  const [crop, setCrop] = useState<Rect | null>(null); // applied crop in image px
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ kind: "pan" | "crop"; x0: number; y0: number; view: View } | null>(null);

  // Fit the whole image in the stage, centred.
  const reset = useCallback(
    (size = natural) => {
      const el = stage.current;
      if (!el || !size) return;
      const s = Math.min(el.clientWidth / size.w, el.clientHeight / size.h);
      const f = { s, x: (el.clientWidth - size.w * s) / 2, y: (el.clientHeight - size.h * s) / 2 };
      setFit(f);
      setView(f);
      setCrop(null);
    },
    [natural],
  );

  // Refit when the stage changes size (window or panel resize).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reset());
    ro.observe(el);
    return () => ro.disconnect();
  }, [reset]);

  const zoom = (factor: number, cx?: number, cy?: number) => {
    const el = stage.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const s = Math.min(fit.s * MAX_ZOOM, Math.max(fit.s * MIN_ZOOM, v.s * factor));
      if (s === fit.s * MIN_ZOOM) return fit; // fully zoomed out: recentre
      const k = s / v.s;
      return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const p = local(e);
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { kind: cropMode ? "crop" : "pan", x0: p.x, y0: p.y, view };
    if (cropMode) setBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    if (d.kind === "pan") setView({ ...d.view, x: d.view.x + p.x - d.x0, y: d.view.y + p.y - d.y0 });
    else setBox({ x: Math.min(p.x, d.x0), y: Math.min(p.y, d.y0), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== "crop" || !box || !natural) return;
    setBox(null);
    if (box.w < 12 || box.h < 12) return; // a click, not a box
    // Stage px -> image px, clamped to the image.
    const x0 = Math.max(0, (box.x - view.x) / view.s);
    const y0 = Math.max(0, (box.y - view.y) / view.s);
    const x1 = Math.min(natural.w, (box.x + box.w - view.x) / view.s);
    const y1 = Math.min(natural.h, (box.y + box.h - view.y) / view.s);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const el = stage.current!;
    const s = Math.min(el.clientWidth / r.w, el.clientHeight / r.h, fit.s * MAX_ZOOM);
    setView({ s, x: (el.clientWidth - r.w * s) / 2 - r.x * s, y: (el.clientHeight - r.h * s) / 2 - r.y * s });
    setCrop(r);
    setCropMode(false);
  };

  const download = () => {
    const el = img.current;
    if (!el || !natural) return;
    const r = crop ?? { x: 0, y: 0, w: natural.w, h: natural.h };
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(r.w);
    canvas.height = Math.round(r.h);
    canvas.getContext("2d")!.drawImage(el, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${downloadName}${crop ? "-crop" : ""}.jpg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      "image/jpeg",
      0.92,
    );
  };

  const zoomPct = Math.round((view.s / fit.s) * 100);
  const { t } = useI18n();

  return (
    <div className="zoom">
      <div
        ref={stage}
        className={`zoom-stage ${cropMode ? "cropping" : view.s > fit.s ? "pannable" : ""}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => {
          const p = local(e);
          if (view.s > fit.s * 1.01) reset();
          else zoom(2.5, p.x, p.y);
        }}
      >
        {failed ? (
          <div className="noimg">{t("drawer.imageUnavailable")}</div>
        ) : (
          <img
            ref={img}
            src={src}
            alt={alt}
            crossOrigin="anonymous"
            draggable={false}
            onLoad={(e) => {
              const size = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
              setNatural(size);
              reset(size);
            }}
            onError={() => setFailed(true)}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, visibility: natural ? "visible" : "hidden" }}
          />
        )}
        {box && <div className="crop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        {cropMode && !box && <div className="crop-hint">{t("zoom.cropHint")}</div>}
      </div>

      <div className="zoom-tools glass" role="toolbar" aria-label={t("zoom.tools")}>
        <button onClick={() => zoom(1 / STEP)} disabled={zoomPct <= 100} aria-label={t("zoom.out")} title={t("zoom.out")}>
          −
        </button>
        <span className="zoom-pct" aria-live="polite">{zoomPct}%</span>
        <button onClick={() => zoom(STEP)} disabled={zoomPct >= MAX_ZOOM * 100} aria-label={t("zoom.in")} title={t("zoom.in")}>
          +
        </button>
        <span className="sep" />
        <button className={cropMode ? "on" : ""} onClick={() => setCropMode((c) => !c)} aria-pressed={cropMode} title={t("zoom.cropTitle")}>
          {t("zoom.crop")}
        </button>
        <button onClick={() => reset()} disabled={zoomPct === 100 && !crop} title={t("zoom.resetTitle")}>
          {t("zoom.reset")}
        </button>
        <button onClick={download} disabled={!natural} title={t(crop ? "zoom.saveCropTitle" : "zoom.saveTitle")}>
          {t(crop ? "zoom.saveCrop" : "zoom.save")}
        </button>
      </div>
    </div>
  );
}
