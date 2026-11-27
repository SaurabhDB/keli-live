// Build game routes from real cameras: one road (VT4, E18, ...), cameras in order along it,
// each stretch with that camera's last known surface.
import { splitName } from "../lib/format";
import type { CameraCondition } from "../types";
import type { Surface } from "./engine";

export const SCENARIOS = ["office_home", "home_shop", "cottage", "school"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface RouteStop {
  place: string;
  surface: Surface;
  roadTempC: number | null;
  lat: number;
  lon: number;
  turnDeg: number; // heading change at this camera (+ = right), from the real coordinates
}

function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return (Math.atan2(x, b.lat - a.lat) * 180) / Math.PI; // 0 = north, 90 = east
}

/** Stops with the real turn at each camera (difference of the bearings in and out). */
function withTurns(cams: CameraCondition[]): RouteStop[] {
  return cams.map((c, i) => {
    let turn = 0;
    if (i > 0 && i < cams.length - 1) {
      turn = bearingDeg(c, cams[i + 1]) - bearingDeg(cams[i - 1], c);
      turn = ((turn + 540) % 360) - 180;
    }
    return { place: splitName(c.name).place, surface: surfaceOf(c), roadTempC: c.road_temp_c, lat: c.lat, lon: c.lon, turnDeg: turn };
  });
}

export interface GameRoute {
  id: string;
  road: string;
  scenario: Scenario;
  from: string;
  to: string;
  stops: RouteStop[];
  hazards: number; // stretches that are not dry or unknown
  distanceKm?: number; // from the viewer to the start, when their location is known
}

const MAX_STOPS = 10;
const MIN_STOPS = 5;

/** Order cameras along a road by projecting them onto the axis with the larger spread. */
function alongRoad(cams: CameraCondition[]): CameraCondition[] {
  const lats = cams.map((c) => c.lat);
  const lons = cams.map((c) => c.lon * Math.cos((64 * Math.PI) / 180)); // degrees of lon are shorter up north
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  const byLat = spread(lats) >= spread(lons);
  return [...cams].sort((a, b) => (byLat ? a.lat - b.lat : a.lon - b.lon));
}

function surfaceOf(c: CameraCondition): Surface {
  return c.road_class ?? "unknown";
}

/** Rough distance in km (equirectangular; plenty for ranking nearby cameras). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(x, b.lat - a.lat) * 111.2;
}

/**
 * Up to ``count`` routes. Without ``near``: the roads with the most slippery stretches. With
 * ``near`` (the viewer's position): the closest roads, each starting at its camera nearest the
 * viewer and heading the way that has more cameras.
 */
export function buildRoutes(cameras: CameraCondition[], count = 4, near?: { lat: number; lon: number } | null): GameRoute[] {
  const byRoad = new Map<string, CameraCondition[]>();
  for (const c of cameras) {
    const { road } = splitName(c.name);
    if (!road) continue;
    byRoad.set(road, [...(byRoad.get(road) ?? []), c]);
  }
  const candidates: (GameRoute & { distanceKm: number })[] = [];
  for (const [road, cams] of byRoad) {
    if (cams.length < MIN_STOPS) continue;
    const ordered = alongRoad(cams);
    let window: CameraCondition[];
    let distanceKm = 0;
    if (near) {
      const dists = ordered.map((c) => km(near, c));
      const i = dists.indexOf(Math.min(...dists));
      distanceKm = dists[i];
      // Head from the nearest camera towards the longer side of the road.
      window = i >= ordered.length - 1 - i ? ordered.slice(Math.max(0, i - MAX_STOPS + 1), i + 1).reverse() : ordered.slice(i, i + MAX_STOPS);
    } else {
      let best = 0;
      let bestScore = -1;
      for (let i = 0; i + Math.min(MAX_STOPS, ordered.length) <= ordered.length; i++) {
        const known = ordered.slice(i, i + MAX_STOPS).filter((c) => c.road_class).length;
        if (known > bestScore) {
          bestScore = known;
          best = i;
        }
      }
      window = ordered.slice(best, best + MAX_STOPS);
    }
    if (window.length < MIN_STOPS) continue;
    const stops = withTurns(window);
    candidates.push({
      id: `${road}-${stops[0].place}`,
      road,
      scenario: SCENARIOS[0],
      from: stops[0].place,
      to: stops[stops.length - 1].place,
      stops,
      hazards: stops.filter((st) => st.surface !== "dry" && st.surface !== "unknown").length,
      distanceKm: Math.round(distanceKm),
    });
  }
  candidates.sort((a, b) =>
    near ? a.distanceKm - b.distanceKm : b.hazards - a.hazards || b.stops.length - a.stops.length,
  );
  return candidates.slice(0, count).map((r, i) => ({ ...r, scenario: SCENARIOS[i % SCENARIOS.length] }));
}
