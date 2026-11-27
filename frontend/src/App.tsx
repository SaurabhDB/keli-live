import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BasemapPicker } from "./components/BasemapPicker";
import { CameraDrawer } from "./components/CameraDrawer";

import { MapView } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { TimeBar } from "./components/TimeBar";
import { LANGS, useI18n } from "./i18n/core";
import { Api } from "./lib/api";
import { currentPosition, inBounds, locationAlreadyAllowed, type Position } from "./lib/geo";
import { autoTheme, saveMode, savedMode, type ThemeMode } from "./lib/theme";
import type { AppConfig, CameraCondition, ConditionsResponse, HealthResponse, MaintenanceResponse, Theme, View } from "./types";

// The game (and anything heavy it pulls in later, like 3D) loads only when opened, so the
// landing page never pays for it.
const DriveGame = lazy(() => import("./components/DriveGame"));

const SNAPSHOT_KEY = "keli.snapshot";

/** The last live cameras, trimmed to what the offline game needs (a few hundred KB at most). */
function saveSnapshot(d: ConditionsResponse) {
  const cameras = d.cameras.map((c) => ({ ...c, presets: [], hazard_reasons: [], hazard_codes: [], treatment: [] }));
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ generated_at: d.generated_at, cameras }));
  } catch {
    // Storage full or disabled: the game then only works while the page keeps its data.
  }
}

function loadSnapshot(): { generated_at: string; cameras: CameraCondition[] } | null {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null");
  } catch {
    return null;
  }
}

const floorTo = (d: Date, minutes: number) => new Date(Math.floor(d.getTime() / (minutes * 60000)) * minutes * 60000);

export default function App({ cfg }: { cfg: AppConfig }) {
  const api = useMemo(() => new Api(cfg.apiBase), [cfg.apiBase]);
  const i18n = useI18n();
  const { t } = i18n;
  const steps = (cfg.timeline.hours * 60) / cfg.timeline.stepMin;

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => savedMode(cfg.theme.mode));
  const [sunTheme, setSunTheme] = useState<Theme>(() => autoTheme(cfg.theme));
  const theme: Theme = themeMode === "auto" ? sunTheme : themeMode;
  const [basemapChoice, setBasemapChoice] = useState(() => localStorage.getItem("keli.basemap") ?? cfg.basemap.default);
  const chosen = basemapChoice in cfg.basemaps ? basemapChoice : "auto"; // ignore stale saved ids
  const basemapId = chosen === "auto" ? (theme === "dark" ? cfg.basemap.autoDark : cfg.basemap.autoLight) : chosen;
  const pickBasemap = (id: string) => {
    localStorage.setItem("keli.basemap", id);
    setBasemapChoice(id);
  };
  const [step, setStep] = useState(steps);
  const [anchor, setAnchor] = useState(() => floorTo(new Date(), cfg.timeline.stepMin)); // "now" of the slider
  const [data, setData] = useState<ConditionsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [view, setView] = useState<View>(cfg.defaultView);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // legend entries switched off
  const [showStations, setShowStations] = useState(true);
  const [showUnlabelled, setShowUnlabelled] = useState(true);
  const [showMaintenance, setShowMaintenance] = useState(cfg.maintenance.showByDefault);
  const [maintenance, setMaintenance] = useState<MaintenanceResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; key: number; zoom?: number } | null>(null);
  const [here, setHere] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [gameOpen, setGameOpen] = useState(() => new URLSearchParams(location.search).has("game"));
  const [gameDismissed, setGameDismissed] = useState(false);

  const timeOf = useCallback(
    (s: number) => new Date(anchor.getTime() - (steps - s) * cfg.timeline.stepMin * 60000),
    [anchor, steps, cfg.timeline.stepMin],
  );
  const at = step === steps ? null : timeOf(step);
  const atKey = at?.getTime() ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Re-check dusk and dawn every few minutes so "auto" flips while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setSunTheme(autoTheme(cfg.theme, new Date(), here ?? undefined)), cfg.theme.recheckMin * 60_000);
    return () => clearInterval(id);
  }, [cfg.theme, here]);

  // Centre on the viewer: silently on open if they already allowed it, else on "Near me".
  const locate = useCallback(
    async (fromButton: boolean) => {
      setLocating(true);
      try {
        const pos = await currentPosition();
        setHere(pos);
        setSunTheme(autoTheme(cfg.theme, new Date(), pos));
        if (inBounds(pos, cfg.map.bounds)) setFlyTo({ ...pos, key: Date.now(), zoom: cfg.geolocation.zoom });
        else if (fromButton) setNotice(t("geo.outside"));
      } catch (e) {
        if (fromButton) setNotice(e instanceof Error ? t(e.message as "geo.failed") : String(e));
      } finally {
        setLocating(false);
      }
    },
    [cfg.theme, cfg.map.bounds, cfg.geolocation.zoom, t],
  );

  useEffect(() => {
    if (!cfg.geolocation.enabled) return;
    let cancelled = false;
    locationAlreadyAllowed().then((ok) => {
      if (ok && !cancelled) void locate(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cfg.geolocation.enabled, locate]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const cycleTheme = () => {
    const next: ThemeMode = themeMode === "auto" ? "light" : themeMode === "light" ? "dark" : "auto";
    saveMode(next);
    setThemeMode(next);
    setSunTheme(autoTheme(cfg.theme, new Date(), here ?? undefined));
  };

  // Conditions for the selected time (debounced while the slider is dragged).
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => {
        api
          .conditions(atKey === null ? null : new Date(atKey), ctrl.signal)
          .then((d) => {
            setData(d);
            setApiDown(false);
            if (atKey === null && d.data_source === "database") saveSnapshot(d);
          })
          .catch((e: unknown) => {
            if (!(e instanceof DOMException && e.name === "AbortError")) setApiDown(true);
          });
      },
      playing ? 0 : 200,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [api, atKey, refreshTick, playing]);

  // Recent winter maintenance for the map layer (same time and refresh as the conditions).
  useEffect(() => {
    if (!showMaintenance) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .maintenance(cfg.maintenance.layerHours, atKey === null ? null : new Date(atKey), ctrl.signal)
        .then(setMaintenance)
        .catch(() => undefined); // the layer is optional; conditions report API problems
    }, playing ? 0 : 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [api, atKey, refreshTick, playing, showMaintenance, cfg.maintenance.layerHours]);

  // Health, plus a periodic refresh while live.
  useEffect(() => {
    const poll = () => {
      api.health().then(setHealth).catch(() => setHealth(null));
    };
    poll();
    const id = setInterval(() => {
      poll();
      if (step === steps && !playing) {
        setAnchor(floorTo(new Date(), cfg.timeline.stepMin));
        setRefreshTick((t) => t + 1);
      }
    }, cfg.refreshS * 1000);
    return () => clearInterval(id);
  }, [api, cfg.refreshS, cfg.timeline.stepMin, step, steps, playing]);

  // Playback: advance one step after each frame has loaded.
  useEffect(() => {
    if (!playing || step >= steps) return;
    const id = setTimeout(() => {
      setStep(step + 1);
      if (step + 1 >= steps) setPlaying(false);
    }, cfg.timeline.playMs);
    return () => clearTimeout(id);
  }, [playing, step, steps, data, cfg.timeline.playMs]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (step === steps) setStep(0);
    setPlaying(true);
  };
  const goLive = () => {
    setPlaying(false);
    setAnchor(floorTo(new Date(), cfg.timeline.stepMin));
    setStep(steps);
  };
  const changeView = (v: View) => {
    setView(v);
    setHidden(new Set()); // filters belong to one view's legend
  };
  const toggleClass = (k: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const pick = (c: CameraCondition) => {
    setSelectedId(c.camera_id);
    setFlyTo({ lon: c.lon, lat: c.lat, key: Date.now() });
  };

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const camera = data?.cameras.find((c) => c.camera_id === selectedId) ?? null;
  // The game drives on the data in memory, or on the snapshot from the last live load.
  const offline = apiDown || !online;
  const snapshot = useMemo(() => (gameOpen || offline ? loadSnapshot() : null), [gameOpen, offline]);
  const gameCameras = data?.cameras ?? snapshot?.cameras ?? [];
  const gameTime = data?.generated_at ?? snapshot?.generated_at ?? null;
  // The live fallback has no history, so time travel is off until the database returns.
  const liveOnly = data?.data_source === "digitraffic_live";

  return (
    <>
      <MapView
        cfg={cfg}
        basemapId={basemapId}
        data={data}
        view={view}
        hidden={hidden}
        showStations={showStations}
        showUnlabelled={showUnlabelled}
        selectedId={selectedId}
        flyTo={flyTo}
        here={here}
        maintenance={maintenance}
        showMaintenance={showMaintenance}
        i18n={i18n}
        onSelect={setSelectedId}
      />
      <Sidebar
        cfg={cfg}
        data={data}
        health={health}
        apiDown={apiDown}
        at={at}
        view={view}
        onView={changeView}
        hidden={hidden}
        showStations={showStations}
        showUnlabelled={showUnlabelled}
        onToggleClass={toggleClass}
        onShowStations={setShowStations}
        showMaintenance={showMaintenance}
        onShowMaintenance={setShowMaintenance}
        onShowUnlabelled={setShowUnlabelled}
        onPick={pick}
      />
      <div className="toolbar">
        {!offline && data && (
          <button className="chip glass" onClick={() => setGameOpen(true)} title={t("game.titleLive")}>
            {t("game.drive")}
          </button>
        )}
        <BasemapPicker ids={["auto", ...Object.keys(cfg.basemaps)]} value={chosen} onChange={pickBasemap} />
        {cfg.geolocation.enabled && (
          <button className="chip glass" onClick={() => void locate(true)} disabled={locating} title={t("tool.nearMeTitle")}>
            {locating ? t("tool.locating") : t("tool.nearMe")}
          </button>
        )}
        <button
          className="chip glass"
          onClick={cycleTheme}
          title={t("tool.themeTitle")}
        >
          {themeMode === "auto"
            ? t("tool.themeAuto", { theme: t(theme === "dark" ? "theme.dark" : "theme.light") })
            : themeMode === "light"
              ? t("tool.themeLight")
              : t("tool.themeDark")}
        </button>
        <div className="chip glass lang" role="group" aria-label={t("lang.title")}>
          {LANGS.map((l) => (
            <button key={l} className={l === i18n.lang ? "on" : ""} aria-pressed={l === i18n.lang} onClick={() => i18n.setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <TimeBar
        disabled={liveOnly}
        steps={steps}
        step={step}
        hours={cfg.timeline.hours}
        timeOf={timeOf}
        playing={playing}
        onStep={(s) => {
          setPlaying(false);
          setStep(s);
        }}
        onPlay={togglePlay}
        onLive={goLive}
      />
      {offline && !gameOpen && !gameDismissed && gameCameras.length > 0 && (
        <div className="toast glass offline-toast" role="status">
          <span>{t("game.offlineNote")}</span>
          <button className="chip" onClick={() => setGameOpen(true)}>{t("game.play")}</button>
          <button className="close static" aria-label={t("drawer.close")} onClick={() => setGameDismissed(true)}>✕</button>
        </div>
      )}
      {gameOpen && (
        <Suspense fallback={<div className="toast glass" role="status">{t("game.loading")}</div>}>
        <DriveGame
          cameras={gameCameras}
          dataTime={gameTime}
          live={!offline && data?.data_source === "database" && at === null}
          near={here}
          night={theme === "dark"}
          onClose={() => setGameOpen(false)}
        />
        </Suspense>
      )}
      {notice && (
        <div className="toast glass" role="status">
          {notice}
        </div>
      )}
      {camera && <CameraDrawer key={camera.camera_id} cfg={cfg} api={api} camera={camera} at={at} onClose={() => setSelectedId(null)} />}
    </>
  );
}
