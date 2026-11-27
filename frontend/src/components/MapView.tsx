import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
// Bundle MapLibre's worker (with its shared chunk) and tell MapLibre where it is: the default
// relative URL breaks once Vite pre-bundles the library.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { I18n } from "../i18n/core";
import { splitName, taskStyle } from "../lib/format";
import { type Legend, legendFor } from "../lib/view";
import type { AppConfig, Basemap, ConditionsResponse, MaintenanceResponse, View } from "../types";

interface Props {
  cfg: AppConfig;
  basemapId: string; // key of cfg.basemaps
  data: ConditionsResponse | null;
  view: View;
  hidden: Set<string>;
  showStations: boolean;
  showUnlabelled: boolean;
  selectedId: string | null;
  flyTo: { lon: number; lat: number; key: number; zoom?: number } | null;
  here: { lat: number; lon: number } | null; // viewer's position, if shared
  maintenance: MaintenanceResponse | null;
  showMaintenance: boolean;
  i18n: I18n; // map tooltips are built outside React, so they read text through props
  onSelect: (id: string | null) => void;
}

maplibregl.setWorkerUrl(workerUrl);

const NONE = "none"; // class value for features without a sensor label
const SOURCES = { cameras: "cameras", stations: "stations", here: "here", maintenance: "maintenance" } as const;
const MAINT_LAYERS = ["maint-line", "maint-point"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// `cls` is the value the current view colours by (surface class or hazard level).
function toGeoJSON(data: ConditionsResponse | null, legend: Legend) {
  const cams = (data?.cameras ?? []).map((c) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
    properties: { id: c.camera_id, cls: legend.valueOf(c) ?? NONE, name: c.name, temp: c.road_temp_c, kind: "camera", reason: JSON.stringify(c.hazard_codes[0] ?? null) },
  }));
  const stas = (data?.stations ?? []).map((s) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
    properties: { id: String(s.station_id), cls: legend.valueOf(s) ?? NONE, name: s.name, temp: s.road_temp_c, kind: "station", reason: JSON.stringify(s.hazard_codes[0] ?? null) },
  }));
  return {
    cameras: { type: "FeatureCollection" as const, features: cams },
    stations: { type: "FeatureCollection" as const, features: stas },
  };
}

function colorExpr(cfg: AppConfig, legend: Legend): ExpressionSpecification {
  const pairs = Object.entries(legend.styles).flatMap(([k, v]) => [k, v.color]);
  return ["match", ["get", "cls"], ...pairs, cfg.noDataColor] as unknown as ExpressionSpecification;
}

/** MapLibre style for a basemap: vector styles by URL, raster tiles wrapped in a style. */
function styleOf(b: Basemap): string | maplibregl.StyleSpecification {
  if (b.kind === "vector") return b.url;
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

const zoomed = (lo: number, hi: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 4, lo, 11, hi];

function addLayers(map: maplibregl.Map, cfg: AppConfig) {
  const color = colorExpr(cfg, legendFor(cfg, cfg.defaultView)); // re-set per view in sync()
  // Maintenance tracks first, so cameras and stations draw on top of them.
  map.addSource(SOURCES.maintenance, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "maint-line",
    type: "line",
    source: SOURCES.maintenance,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": zoomed(2.2, 5.5), "line-opacity": 0.85 },
  });
  map.addLayer({
    id: "maint-point",
    type: "circle",
    source: SOURCES.maintenance,
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": zoomed(2.2, 5.5), "circle-color": ["get", "color"], "circle-opacity": 0.85 },
  });
  map.addSource(SOURCES.stations, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource(SOURCES.cameras, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource(SOURCES.here, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "stations",
    type: "circle",
    source: SOURCES.stations,
    paint: { "circle-radius": zoomed(2.6, 6.5), "circle-color": color, "circle-opacity": 0.75 },
  });
  map.addLayer({
    id: "cam-glow",
    type: "circle",
    source: SOURCES.cameras,
    paint: { "circle-radius": zoomed(12, 32), "circle-color": color, "circle-opacity": 0.22, "circle-blur": 1 },
  });
  map.addLayer({
    id: "cam-unlabelled",
    type: "circle",
    source: SOURCES.cameras,
    paint: {
      "circle-radius": zoomed(3.6, 8),
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": cfg.noDataColor,
      "circle-stroke-width": 1.6,
      "circle-stroke-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "ice-pulse",
    type: "circle",
    source: SOURCES.cameras,
    paint: {
      "circle-radius": zoomed(8, 18),
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": cfg.hazards.high.color,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.6,
    },
  });
  map.addLayer({
    id: "cameras",
    type: "circle",
    source: SOURCES.cameras,
    paint: {
      "circle-radius": zoomed(5.2, 12),
      "circle-color": color,
      "circle-stroke-color": "rgba(10,14,24,0.9)",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "here-halo",
    type: "circle",
    source: SOURCES.here,
    paint: { "circle-radius": 22, "circle-color": "#4aa3ff", "circle-opacity": 0.18 },
  });
  map.addLayer({
    id: "here",
    type: "circle",
    source: SOURCES.here,
    paint: { "circle-radius": 8, "circle-color": "#4aa3ff", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
  });
  map.addLayer({
    id: "selected",
    type: "circle",
    source: SOURCES.cameras,
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": zoomed(10, 19),
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
}

export function MapView(props: Props) {
  const { cfg, basemapId, data, view, hidden, showStations, showUnlabelled, selectedId, flyTo, here, maintenance, showMaintenance } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const latest = useRef(props); // handlers read props through this ref so they never go stale
  useLayoutEffect(() => {
    latest.current = props;
  });

  // Push data, filters and selection into the map (also after a style switch).
  const sync = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const p = latest.current;
    const legend = legendFor(p.cfg, p.view);
    const geo = toGeoJSON(p.data, legend);
    const color = colorExpr(p.cfg, legend);
    for (const layer of ["stations", "cam-glow", "cameras"]) map.setPaintProperty(layer, "circle-color", color);
    const worst = legend.order[0]; // most severe entry pulses: "high" or "ice_risk"
    map.setPaintProperty("ice-pulse", "circle-stroke-color", legend.styles[worst].color);
    (map.getSource(SOURCES.cameras) as GeoJSONSource).setData(geo.cameras);
    (map.getSource(SOURCES.stations) as GeoJSONSource).setData(geo.stations);
    (map.getSource(SOURCES.maintenance) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (p.maintenance?.features ?? []).flatMap((f) => {
        const style = taskStyle(f.properties.tasks, p.cfg.maintenance.tasks);
        return style ? [{ ...f, properties: { ...f.properties, color: style.color, task: style.key } }] : [];
      }),
    });
    for (const layer of MAINT_LAYERS) map.setLayoutProperty(layer, "visibility", p.showMaintenance ? "visible" : "none");
    (map.getSource(SOURCES.here) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.here
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [p.here.lon, p.here.lat] }, properties: {} }]
        : [],
    });
    const visible: ExpressionSpecification = ["!", ["in", ["get", "cls"], ["literal", [...p.hidden]]]];
    const labelled: ExpressionSpecification = ["all", ["!=", ["get", "cls"], NONE], visible];
    map.setFilter("cameras", labelled);
    map.setFilter("cam-glow", labelled);
    map.setFilter("ice-pulse", ["all", ["==", ["get", "cls"], worst], visible]);
    map.setFilter("cam-unlabelled", ["==", ["get", "cls"], p.showUnlabelled ? NONE : "__hidden__"]);
    map.setFilter("stations", p.showStations ? visible : ["==", ["get", "cls"], "__hidden__"]);
    map.setFilter("selected", ["==", ["get", "id"], p.selectedId ?? ""]);
  };

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: styleOf(cfg.basemaps[basemapId]),
      bounds: cfg.map.bounds,
      // Keep Finland clear of the side panel (left) and time bar (bottom).
      fitBoundsOptions: { padding: { top: 40, bottom: 110, left: window.innerWidth > 860 ? 400 : 20, right: 40 } },
      minZoom: cfg.map.minZoom,
      maxZoom: cfg.map.maxZoom,
      // Basemap credits (OpenStreetMap, CARTO) come from the style; Digitraffic's is ours.
      attributionControl: { compact: true, customAttribution: cfg.dataAttribution },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("style.load", () => {
      map.resize(); // in case the container was laid out after the map was created
      addLayers(map, cfg);
      ready.current = true;
      sync();
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "map-tip" });
    for (const layer of MAINT_LAYERS) {
      map.on("mousemove", layer, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const { t, tk, ago } = latest.current.i18n;
        const el = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = tk(`task.${String(f.properties.task)}`);
        const sub = document.createElement("div");
        sub.textContent = t("map.finished", { ago: ago(String(f.properties.end_time)) });
        el.append(title, sub);
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });
      map.on("mouseleave", layer, () => popup.remove());
    }
    const hoverable = ["cameras", "cam-unlabelled", "stations"];
    for (const layer of hoverable) {
      map.on("mousemove", layer, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = f.properties.kind === "camera" ? "pointer" : "";
        const { t, tk, num, reason } = latest.current.i18n;
        const { place, road } = splitName(String(f.properties.name));
        const k = String(f.properties.cls);
        const { prefix } = legendFor(cfg, latest.current.view);
        const label = k === NONE ? t("map.noSensor") : tk(`${prefix}.${k}`);
        const temp =
          f.properties.temp === null || f.properties.temp === undefined
            ? ""
            : t("map.road", { temp: num(Number(f.properties.temp), " °C") });
        const el = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = place;
        const sub = document.createElement("div");
        sub.textContent = `${f.properties.kind === "station" ? t("map.station") : road || t("map.camera")} · ${label}${temp}`;
        el.append(title, sub);
        const code = JSON.parse(String(f.properties.reason ?? "null")) as { code: string; params: Record<string, number> } | null;
        if (code && latest.current.view === "hazard") {
          const why = document.createElement("div");
          why.className = "tip-reason";
          why.textContent = reason(code.code, code.params);
          el.append(why);
        }
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["cameras", "cam-unlabelled"] })[0];
      latest.current.onSelect(hit ? String(hit.properties.id) : null);
    });

    // Ice-risk pulse: animate one ring layer (about 30 fps).
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (reducedMotion || !ready.current || t - last < 33 || !map.getLayer("ice-pulse")) return;
      last = t;
      const phase = (t % 1800) / 1800;
      const grow = 1 + phase * 1.6;
      map.setPaintProperty("ice-pulse", "circle-radius", zoomed(8 * grow, 18 * grow));
      map.setPaintProperty("ice-pulse", "circle-stroke-opacity", 0.7 * (1 - phase));
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // The map is created once; later prop changes are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap switch: a new style drops our layers; "style.load" re-adds them.
  const shownBasemap = useRef(basemapId);
  useEffect(() => {
    if (basemapId === shownBasemap.current) return;
    shownBasemap.current = basemapId;
    ready.current = false;
    mapRef.current?.setStyle(styleOf(cfg.basemaps[basemapId]));
  }, [basemapId, cfg]);

  useEffect(sync, [data, view, hidden, showStations, showUnlabelled, selectedId, here, maintenance, showMaintenance]);

  useEffect(() => {
    if (flyTo) mapRef.current?.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? Math.max(mapRef.current.getZoom(), 10.5), speed: 1.4 });
  }, [flyTo]);

  return <div ref={container} className="map" aria-label="Map of road conditions" />;
}
