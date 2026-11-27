import type { Geometry } from "geojson";

// Shapes of public/config.json and the Keli Live API (keli/api/schemas.py).

export type RoadClass = "dry" | "wet" | "slush" | "snow" | "ice_risk";
export type Theme = "dark" | "light";
export type HazardLevel = "high" | "medium" | "low";
/** Colour the map by driving hazard or by surface class. */
export type View = "hazard" | "surface";
/** "digitraffic_live" when the API's database is down: latest data only, no history. */
export type DataSource = "database" | "digitraffic_live";

/** Legend colour; its label and hint come from the translations (class.*, hazard.*). */
export interface ClassStyle {
  color: string;
}

/** A map background: a vector style URL, or raster tiles wrapped into a style in code. */
export type Basemap =
  | { kind: "vector"; url: string; dark: boolean }
  | { kind: "raster"; tiles: string[]; maxzoom: number; attribution: string; dark: boolean };

export interface AppConfig {
  apiBase: string;
  imageBase: string;
  dataAttribution: string; // HTML shown in the map's attribution control (CC BY 4.0 credit)
  refreshS: number;
  historyHours: number;
  trainingRadiusM: number;
  timeline: { hours: number; stepMin: number; playMs: number };
  map: { bounds: [[number, number], [number, number]]; minZoom: number; maxZoom: number }; // bounds: [[w, s], [e, n]]
  geolocation: { enabled: boolean; zoom: number }; // centre on the viewer if inside map.bounds
  theme: {
    mode: "auto" | Theme; // default before the viewer picks one
    sunLocation: { lat: number; lon: number; timeZones: string[] }; // viewers "in Finland"
    darkBelowSunAltitudeDeg: number; // -6 = civil dusk
    fallbackDarkHours: [number, number]; // [from, until] local hours, for viewers elsewhere
    recheckMin: number;
  };
  basemaps: Record<string, Basemap>; // free, no-key styles; names in i18n basemap.<id>
  basemap: { default: string; autoDark: string; autoLight: string }; // "auto" follows the theme
  classes: Record<RoadClass, ClassStyle>; // key order = legend order, most severe first
  hazards: Record<HazardLevel, ClassStyle>; // same, for the hazard view
  defaultView: View;
  maintenance: {
    layerHours: number;
    showByDefault: boolean;
    tasks: Record<string, { color: string }>; // key order = colour priority; labels: task.*
  };
  noDataColor: string;
}

export interface Measurements {
  road_class: RoadClass | null;
  source: "sensor" | "optical" | null;
  road_temp_c: number | null;
  air_temp_c: number | null;
  friction: number | null;
  measured_at: string | null;
  hazard: HazardLevel | null;
  hazard_reasons: string[]; // English
  hazard_codes: { code: string; params: Record<string, number> }[]; // translated in the UI
}

export interface CameraCondition extends Measurements {
  camera_id: string;
  name: string;
  lat: number;
  lon: number;
  station_id: number | null;
  station_dist_m: number | null;
  presets: string[];
  thumb_url: string | null;
  treated_at: string | null; // latest winter maintenance within ~150 m, last 12 h
  treatment: string[];
  treatment_dist_m: number | null;
}

export interface StationCondition extends Measurements {
  station_id: number;
  name: string;
  lat: number;
  lon: number;
}

export interface ConditionsResponse {
  generated_at: string;
  at: string;
  cameras: CameraCondition[];
  stations: StationCondition[];
  attribution: string;
  data_source: DataSource;
}

export interface HistoryPoint extends Measurements {
  t: string;
}

export interface Streak {
  value: string;
  since: string;
  previous: string | null; // value before the change; null if unknown
  complete: boolean; // false: "for at least" (window start or data gap reached)
}

export interface HistoryResponse {
  camera_id: string;
  station_id: number | null;
  station_dist_m: number | null;
  labelled: boolean;
  points: HistoryPoint[];
  data_source: DataSource;
  surface_streak: Streak | null;
  hazard_streak: Streak | null;
}

export interface HealthResponse {
  status: "ok" | "stale" | "degraded";
  data_source: DataSource;
  newest_reading_at: string | null;
  data_age_s: number | null;
}

export interface Treatment {
  end_time: string;
  tasks: string[];
  dist_m: number;
}

export interface ForecastItem {
  name: string; // 0h (observation), 2h, 4h, 6h, 12h
  valid_at: string;
  kind: "OBSERVATION" | "FORECAST" | string;
  road_temp_c: number | null;
  air_temp_c: number | null;
  road_condition: string | null;
  overall_condition: string | null;
}

export interface OutlookResponse {
  camera_id: string;
  treatments: Treatment[];
  forecast: {
    section_id: string;
    description: string;
    dist_m: number;
    issued_at: string;
    items: ForecastItem[];
  } | null;
  data_source: DataSource;
}

export interface MaintenanceResponse {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: Geometry; properties: { id: number; end_time: string; tasks: string[] } }[];
}
