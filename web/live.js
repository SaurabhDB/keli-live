// Live Helsinki layer: real Digitraffic cameras + road weather sensors.
// Data: Fintraffic / digitraffic.fi, license CC 4.0 BY. No API key needed.

const API = "https://tie.digitraffic.fi";
const IMG = "https://weathercam.digitraffic.fi";
const HELSINKI = [60.1699, 24.9384];
const LIVE_COUNT = 8;          // cameras to show
const LIVE_RADIUS_KM = 15;     // search radius around central Helsinki

// Official KELI codes (from /api/weather/v1/sensors) -> Keli Live class
const KELI_TO_CLASS = { 1: "dry", 2: "wet", 3: "wet", 4: "wet", 8: "wet", 9: "slush", 6: "snow", 5: "ice", 7: "ice" };

const liveLayer = L.layerGroup().addTo(map);
let liveCams = [];

function km(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function getJson(path) {
  // Digitraffic asks clients to identify themselves; fall back without the header if the browser blocks it.
  try {
    const r = await fetch(API + path, { headers: { "Digitraffic-User": "KeliLive/prototype" } });
    if (r.ok) return r.json();
  } catch (e) { /* retry below */ }
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function sensorMap(stationData) {
  const out = {};
  (stationData.sensorValues || []).forEach((v) => (out[v.name] = v));
  return out;
}

// Turn real sensor readings into a Keli Live class (sensor-based until the camera model is trained)
function classFromSensors(s) {
  const keli = s.KELI_1 || s.OPTISEN_ANTURIN_KELI1;
  const code = keli ? Math.round(keli.value) : null;
  let cls = code !== null ? KELI_TO_CLASS[code] : null;
  const temp = s.TIE_1 ? s.TIE_1.value : null;
  const warn = s.VAROITUS_1 ? Math.round(s.VAROITUS_1.value) : null;
  if (warn === 2 || warn === 3) cls = "ice";                            // alarm or frost warning
  // Unsalted moist/wet (2, 3) at or below 0 °C is ice risk. Salty codes 4 and 8 stay wet:
  // salt lowers the freezing point, so flagging them would show false ice on every salted road.
  if ((code === 2 || code === 3) && cls === "wet" && temp !== null && temp <= 0) cls = "ice";
  return cls || "unusable";
}

function ageMin(iso) {
  return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;
}

async function loadLive() {
  const status = document.getElementById("liveStatus");
  status.textContent = "Loading cameras…";
  try {
    // 1. All camera stations -> the collecting ones nearest central Helsinki
    const cams = (await getJson("/api/weathercam/v1/stations")).features
      .filter((f) => [undefined, null, "GATHERING"].includes(f.properties.collectionStatus))
      .map((f) => ({ id: f.properties.id, name: f.properties.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }))
      .map((c) => ({ ...c, dist: km(HELSINKI, [c.lat, c.lon]) }))
      .filter((c) => c.dist <= LIVE_RADIUS_KM)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, LIVE_COUNT);

    // 2. Weather station locations (to measure camera-to-sensor distance)
    status.textContent = "Loading road weather stations…";
    const stations = {};
    (await getJson("/api/weather/v1/stations")).features.forEach((f) =>
      (stations[f.id] = { name: f.properties.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));

    // 3. Camera details (presets + paired station), then that station's live sensors
    status.textContent = "Loading live sensor readings…";
    const sensorCache = {};
    liveCams = await Promise.all(cams.map(async (c) => {
      const p = (await getJson(`/api/weathercam/v1/stations/${c.id}`)).properties;
      const preset = (p.presets || []).find((x) => x.inCollection !== false) || (p.presets || [])[0];
      const wsId = p.nearestWeatherStationId;
      let sensors = {}, wsDist = null;
      if (wsId) {
        sensorCache[wsId] ??= getJson(`/api/weather/v1/stations/${wsId}/data`).then(sensorMap).catch(() => ({}));
        sensors = await sensorCache[wsId];
        if (stations[wsId]) wsDist = km([c.lat, c.lon], [stations[wsId].lat, stations[wsId].lon]);
      }
      return { ...c, presetId: preset && preset.id, wsId, wsName: stations[wsId]?.name, wsDist, sensors, cls: classFromSensors(sensors) };
    }));

    drawLive();
    map.flyTo(HELSINKI, 11);
    status.textContent = `Live · updated ${new Date().toTimeString().slice(0, 5)} · refreshes every 10 min`;
  } catch (e) {
    status.textContent = "Could not load live data: " + e.message;
    console.error(e);
  }
}

function drawLive() {
  liveLayer.clearLayers();
  document.getElementById("liveList").innerHTML = liveCams.map((c, i) =>
    `<li data-i="${i}"><span class="sw" style="background:${CLASSES[c.cls].color}"></span>
      ${c.name}<small>${CLASSES[c.cls].label} · sensor ${c.wsDist == null ? "none" : c.wsDist.toFixed(1) + " km away"}</small></li>`).join("");
  document.querySelectorAll("#liveList li").forEach((li) => (li.onclick = () => showLiveDetail(liveCams[+li.dataset.i])));

  liveCams.forEach((c) => {
    const col = CLASSES[c.cls].color;
    const near = c.wsDist != null && c.wsDist < 0.5;
    L.circleMarker([c.lat, c.lon], { radius: 11, weight: 3, color: "#111", fillColor: col, fillOpacity: near ? 0.95 : 0.35, dashArray: near ? null : "3 3" })
      .bindTooltip(`LIVE · ${c.name}: ${CLASSES[c.cls].label}`)
      .on("click", () => showLiveDetail(c))
      .addTo(liveLayer);
  });
}

function showLiveDetail(c) {
  selected = null; // stop the dummy panel from re-rendering over this one
  const s = c.sensors, k = CLASSES[c.cls];
  const row = (label, v) => `<tr><td>${label}</td><td>${v}</td></tr>`;
  const val = (x) => (x ? `${x.value} ${x.unit && !/^[*?]+$/.test(x.unit) ? x.unit : ""}`.trim() : "—");
  const desc = (x) => (x ? x.sensorValueDescriptionEn || x.value : "—");
  const t = s.TIE_1 || s.KELI_1;
  const near = c.wsDist != null && c.wsDist < 0.5;
  const img = c.presetId ? `${IMG}/${c.presetId}.jpg` : "";
  document.getElementById("detail").innerHTML = `
    <button class="close" onclick="closeDetail()">✕</button>
    ${img ? `<a href="${img}" target="_blank"><img class="liveimg" src="${img}?thumbnail=true" alt="Live camera image"></a>` : ""}
    <div class="body">
      <h3>${c.name}</h3><div class="hint">${c.presetId || c.id} · ${c.dist.toFixed(1)} km from central Helsinki · click image for full size</div>
      <p><span class="pill" style="background:${k.color}">${k.label}</span> <span class="pill" style="background:#111">LIVE</span></p>
      <table>
        ${row("Sensor station", c.wsName ? `${c.wsName} (${c.wsDist.toFixed(1)} km)` : "none paired")}
        ${row("Road condition (in-road)", desc(s.KELI_1))}
        ${row("Road condition (optical)", desc(s.OPTISEN_ANTURIN_KELI1))}
        ${row("Warning", desc(s.VAROITUS_1))}
        ${row("Road temperature", val(s.TIE_1))}
        ${row("Air temperature", val(s.ILMA))}
        ${row("Grip (friction)", val(s.KITKA1_LUKU || s.KITKA1))}
        ${row("Sensor reading age", t ? ageMin(t.measuredTime) + " min" : "—")}
      </table>
      <div class="why">${near
        ? "Sensor is next to the camera: this reading is a trustworthy training label for the image."
        : "Sensor is not next to the camera: today this is only a regional hint. The trained camera model will read this image directly."}
        Source: Fintraffic / digitraffic.fi, CC BY 4.0.</div>
    </div>`;
  document.getElementById("detail").classList.remove("hidden");
}

document.getElementById("liveBtn").onclick = loadLive;
setInterval(() => liveCams.length && loadLive(), 10 * 60 * 1000);
loadLive();
