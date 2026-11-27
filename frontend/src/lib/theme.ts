import type { AppConfig, Theme } from "../types";

export type ThemeMode = "auto" | Theme;
const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const J2000_DAYS = 10957.5; // 2000-01-01 12:00 UTC in days since the Unix epoch

/**
 * Sun altitude in degrees at a place and time (low-precision NOAA/USNO formula, ±0.5°,
 * plenty for choosing a colour scheme).
 */
export function sunAltitudeDeg(date: Date, lat: number, lon: number): number {
  const d = date.getTime() / MS_PER_DAY - J2000_DAYS;
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude, degrees
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstDeg = (18.697374558 + 24.06570982441908 * d) * 15;
  const hourAngle = (gmstDeg + lon) * RAD - ra;
  const latR = lat * RAD;
  return Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}

/**
 * The theme "auto" resolves to now. With the viewer's position, the sun there decides.
 * Otherwise viewers in Finland (by browser time zone) get dark once
 * the sun over the configured Finnish location is below the dusk threshold; everyone else
 * follows their own clock.
 */
export function autoTheme(cfg: AppConfig["theme"], now = new Date(), here?: { lat: number; lon: number }): Theme {
  if (here) {
    // The viewer shared their location: use the sun where they actually are.
    return sunAltitudeDeg(now, here.lat, here.lon) < cfg.darkBelowSunAltitudeDeg ? "dark" : "light";
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (cfg.sunLocation.timeZones.includes(zone)) {
    const alt = sunAltitudeDeg(now, cfg.sunLocation.lat, cfg.sunLocation.lon);
    return alt < cfg.darkBelowSunAltitudeDeg ? "dark" : "light";
  }
  const [darkFrom, darkUntil] = cfg.fallbackDarkHours;
  const h = now.getHours();
  return h >= darkFrom || h < darkUntil ? "dark" : "light";
}

const STORAGE_KEY = "keli.themeMode";

export function savedMode(fallback: ThemeMode): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "auto" || v === "light" || v === "dark" ? v : fallback;
}

export function saveMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}
