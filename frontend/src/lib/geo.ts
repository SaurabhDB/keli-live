/** Browser geolocation. Positions stay in the browser: never sent to the API or anyone else. */

export interface Position {
  lat: number;
  lon: number;
}

/** True only if the viewer has already allowed location for this site (no prompt shown). */
export async function locationAlreadyAllowed(): Promise<boolean> {
  if (!("geolocation" in navigator) || !navigator.permissions) return false;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false; // some browsers cannot query this permission
  }
}

/** Current position; shows the browser's permission prompt if not yet decided. */
export function currentPosition(timeoutMs = 10_000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("geo.unsupported")); // message = translation key
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "geo.denied" : "geo.failed")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60_000 },
    );
  });
}

/** Inside [[west, south], [east, north]]. */
export function inBounds(p: Position, [[w, s], [e, n]]: [[number, number], [number, number]]): boolean {
  return p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
}
