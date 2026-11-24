// Keli Live prototype. ALL DATA BELOW IS DUMMY, generated in the browser.
// The real version replaces generateState() with Digitraffic cameras + sensors + the trained model.

const CLASSES = {
  dry:      { label: "Dry",           color: "#27ae60" },
  wet:      { label: "Wet",           color: "#2980b9" },
  slush:    { label: "Slush",         color: "#f39c12" },
  snow:     { label: "Snow-covered",  color: "#7f8c8d" },
  ice:      { label: "Ice risk",      color: "#c0392b" },
  unusable: { label: "Image unusable", color: "#bdc3c7" },
};

// [name, road, lat, lon, hasSensorNearby]
const CAMERAS = [
  ["Helsinki Ruoholahti", "Länsiväylä", 60.163, 24.913, true],
  ["Helsinki Lauttasaari", "Länsiväylä", 60.158, 24.875, false],
  ["Vantaa Ring III", "Kehä III", 60.300, 24.850, true],
  ["Espoo Kehä I", "Kehä I", 60.210, 24.780, false],
  ["Porvoo", "E18", 60.390, 25.660, false],
  ["Kotka", "E18", 60.470, 26.950, true],
  ["Salo", "E18", 60.380, 23.120, false],
  ["Turku", "VT1", 60.450, 22.270, true],
  ["Rauma", "VT8", 61.130, 21.510, false],
  ["Pori", "VT8", 61.480, 21.800, false],
  ["Hämeenlinna", "VT3", 61.000, 24.460, true],
  ["Tampere Hervanta", "VT3", 61.450, 23.850, false],
  ["Lahti", "VT4", 60.980, 25.660, false],
  ["Lappeenranta", "VT6", 61.060, 28.190, false],
  ["Mikkeli", "VT5", 61.690, 27.270, true],
  ["Jyväskylä", "VT4", 62.240, 25.750, false],
  ["Varkaus", "VT23", 62.310, 27.870, false],
  ["Kuopio", "VT5", 62.890, 27.680, true],
  ["Joensuu", "VT6", 62.600, 29.760, false],
  ["Seinäjoki", "VT19", 62.790, 22.840, false],
  ["Vaasa", "VT8", 63.100, 21.620, true],
  ["Kokkola", "VT8", 63.840, 23.130, false],
  ["Kajaani", "VT5", 64.220, 27.730, false],
  ["Oulu", "VT4", 65.010, 25.470, true],
  ["Ii", "VT4", 65.320, 25.370, false],
  ["Kemi", "VT4", 65.740, 24.560, false],
  ["Kuusamo", "VT20", 65.960, 29.180, false],
  ["Rovaniemi", "VT4", 66.500, 25.730, true],
  ["Sodankylä", "VT4", 67.420, 26.590, false],
  ["Ivalo", "VT4", 68.660, 27.540, false],
].map(([name, road, lat, lon, sensor], i) => ({ id: "C" + String(1000 + i), name, road, lat, lon, sensor }));

const ROUTES = {
  "Helsinki → Tampere (VT3)": ["Helsinki Ruoholahti", "Vantaa Ring III", "Hämeenlinna", "Tampere Hervanta"],
  "Helsinki → Turku (E18)":   ["Espoo Kehä I", "Salo", "Turku"],
  "Helsinki → Jyväskylä (VT4)": ["Vantaa Ring III", "Lahti", "Jyväskylä"],
  "Oulu → Rovaniemi (VT4)":   ["Oulu", "Ii", "Kemi", "Rovaniemi"],
};

const STEPS = 36;            // 6 hours of 10-minute steps
const NOW = new Date();
NOW.setMinutes(Math.floor(NOW.getMinutes() / 10) * 10, 0, 0);

// small deterministic random so the demo looks the same every reload
function rand(seed) { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); }

// Dummy physics: colder in the north, a cold front moving south over the 6 hours.
function generateState(cam, i, t) {
  const frontLat = 66.5 - t * 0.17;                 // front reaches ~60.4 by the end
  let roadTemp = 3.2 - (cam.lat - 60) * 1.1 + (rand(i) - 0.5) * 1.5;
  if (cam.lat > frontLat) roadTemp -= 3.0;
  roadTemp = Math.round(roadTemp * 10) / 10;
  const wet = rand(i * 7 + Math.floor(t / 6)) > 0.35;   // precipitation / moisture
  const snowing = cam.lat > frontLat && rand(i * 3 + t) > 0.55;

  let cls;
  if (cam.name === "Kuusamo" && t > 20) cls = "unusable";          // e.g. lens covered by snow
  else if (roadTemp >= 1.5) cls = wet ? "wet" : "dry";
  else if (roadTemp >= -0.5) cls = snowing ? "slush" : wet ? "ice" : "dry";
  else cls = snowing || wet ? "snow" : (rand(i + t) > 0.5 ? "ice" : "dry");

  const friction = { dry: 0.82, wet: 0.72, slush: 0.45, snow: 0.35, ice: 0.25, unusable: null }[cls];
  const confidence = cls === "unusable" ? 0 : cam.sensor ? 0.95 : 0.7 + rand(i * 11 + t) * 0.22;
  // what the morning forecast said (dummy): it misses the front in the south
  const forecast = roadTemp + (cam.lat < 62.5 ? 2.5 : 0) >= 1.5 ? "dry / wet" : "slippery";
  const mismatch = cls === "ice" && forecast === "dry / wet";
  return { cls, roadTemp, friction, confidence, forecast, mismatch };
}

// Two dummy traffic announcements, appearing during the replay
const ACCIDENTS = [
  { at: 24, cam: "Hämeenlinna", text: "Vehicle off the road, one lane closed" },
  { at: 31, cam: "Mikkeli", text: "Two-car collision, traffic slowed" },
];

// ---------- map ----------
const map = L.map("map", { zoomControl: true }).setView([64.2, 25.8], 5);
// OpenStreetMap tiles: free, no API key. Run from a local server (see README) so OSM accepts the requests.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 12,
}).addTo(map);

const markers = CAMERAS.map((cam) => {
  const m = L.circleMarker([cam.lat, cam.lon], { radius: 9, weight: 3 }).addTo(map);
  m.on("click", () => showDetail(cam));
  return m;
});
const accidentLayer = L.layerGroup().addTo(map);

let t = STEPS, current = [], selected = null;

function timeLabel(step) {
  const d = new Date(NOW.getTime() - (STEPS - step) * 600000);
  return d.toTimeString().slice(0, 5) + (step === STEPS ? " · live" : "");
}

function render() {
  current = CAMERAS.map((cam, i) => generateState(cam, i, t));
  CAMERAS.forEach((cam, i) => {
    const s = current[i], c = CLASSES[s.cls].color;
    markers[i].setStyle({ color: c, fillColor: c, fillOpacity: cam.sensor ? 0.9 : 0.15 });
    markers[i].bindTooltip(`${cam.name}: ${CLASSES[s.cls].label}`);
  });

  document.getElementById("clock").textContent = timeLabel(t);
  const n = (k) => current.filter((s) => s.cls === k).length;
  const sensorCount = CAMERAS.filter((c) => c.sensor).length;
  const alerts = CAMERAS.map((c, i) => ({ c, s: current[i] })).filter((x) => x.s.mismatch);
  document.getElementById("stats").innerHTML = `
    <div class="stat"><b>809</b><span>road cameras in Finland (30 shown)</span></div>
    <div class="stat"><b>20% → 100%</b><span>coverage: sensors only → with AI</span></div>
    <div class="stat warn"><b>${n("ice")}</b><span>cameras with ice risk</span></div>
    <div class="stat"><b>${n("snow") + n("slush")}</b><span>snow or slush</span></div>`;

  // alerts: forecast mismatches + accident announcements
  const list = alerts.map((x) =>
    `<li data-cam="${x.c.name}">Ice risk at ${x.c.name} (${x.c.road})<small>Forecast said ${x.s.forecast}; camera shows ice risk, road ${x.s.roadTemp} °C</small></li>`);
  accidentLayer.clearLayers();
  ACCIDENTS.filter((a) => t >= a.at).forEach((a) => {
    const cam = CAMERAS.find((c) => c.name === a.cam);
    L.marker([cam.lat + 0.12, cam.lon + 0.25], {
      icon: L.divIcon({ html: "⚠️", className: "", iconSize: [18, 18] }),
    }).bindTooltip("Traffic announcement (dummy): " + a.text).addTo(accidentLayer);
    list.push(`<li class="acc" data-cam="${a.cam}">Accident near ${a.cam}<small>${a.text}. Road condition there: ${CLASSES[current[CAMERAS.indexOf(cam)].cls].label}</small></li>`);
  });
  document.getElementById("alerts").innerHTML = list.join("") || "<li>No alerts</li>";
  document.getElementById("alertCount").textContent = list.length;
  document.querySelectorAll("#alerts li[data-cam]").forEach((li) =>
    li.onclick = () => showDetail(CAMERAS.find((c) => c.name === li.dataset.cam)));

  renderBrief();
  if (selected) showDetail(selected);
}

function showDetail(cam) {
  selected = cam;
  const i = CAMERAS.indexOf(cam), s = current[i], k = CLASSES[s.cls];
  const why = s.cls === "unusable"
    ? "Image blurred or covered: no prediction, shown honestly as unusable."
    : cam.sensor
      ? "A roadside sensor within 0.5 km confirms this. Cameras like this one are used to train the model."
      : "No sensor nearby. This is the AI model reading the driving lane in the image. This is the 80% gap Keli Live fills.";
  document.getElementById("detail").innerHTML = `
    <button class="close" onclick="closeDetail()">✕</button>
    <div class="cam ${s.cls}"><div class="verge"></div><div class="road"></div><div class="lane"></div>
      <span class="label">${cam.id} · ${timeLabel(t)} · placeholder image</span></div>
    <div class="body">
      <h3>${cam.name}</h3><div class="hint">${cam.road}</div>
      <p><span class="pill" style="background:${k.color}">${k.label}</span>
         ${s.mismatch ? '<span class="pill" style="background:#c0392b">Forecast mismatch</span>' : ""}</p>
      <table>
        <tr><td>Source</td><td>${cam.sensor ? "Sensor + camera" : "Camera AI only"}</td></tr>
        <tr><td>Confidence</td><td>${s.confidence ? Math.round(s.confidence * 100) + "%" : "—"}</td></tr>
        <tr><td>Road temperature</td><td>${cam.sensor ? s.roadTemp + " °C" : "≈ " + s.roadTemp + " °C (nearest station)"}</td></tr>
        <tr><td>Grip (friction)</td><td>${s.friction ?? "—"}</td></tr>
        <tr><td>Morning forecast</td><td>${s.forecast}</td></tr>
      </table>
      <div class="why">${why}</div>
    </div>`;
  document.getElementById("detail").classList.remove("hidden");
}
function closeDetail() { selected = null; document.getElementById("detail").classList.add("hidden"); }

// Route brief: in the real version an LLM agent writes this from the same data.
function renderBrief() {
  const name = document.getElementById("route").value;
  const stops = ROUTES[name].map((n) => { const i = CAMERAS.findIndex((c) => c.name === n); return { cam: CAMERAS[i], s: current[i] }; });
  const bad = stops.filter((x) => ["ice", "snow", "slush"].includes(x.s.cls));
  const worst = bad.find((x) => x.s.cls === "ice") || bad[0];
  let text;
  if (!bad.length) text = `Good conditions along the route. Roads are ${[...new Set(stops.map((x) => CLASSES[x.s.cls].label.toLowerCase()))].join(" or ")}. Normal driving.`;
  else text = `${bad.length} of ${stops.length} checkpoints show poor grip. Worst: <b>${CLASSES[worst.s.cls].label.toLowerCase()} near ${worst.cam.name}</b> (road ${worst.s.roadTemp} °C). ` +
    (worst.s.cls === "ice" ? "Black ice is likely where the road looks only wet. Keep longer gaps and avoid sudden braking." : "Expect slower traffic; allow extra time.");
  document.getElementById("brief").innerHTML = `<div class="who">AI route brief · ${timeLabel(t)} · (template here; LLM agent in the real version)</div>${text}`;
}

// ---------- controls ----------
const routeSel = document.getElementById("route");
routeSel.innerHTML = Object.keys(ROUTES).map((r) => `<option>${r}</option>`).join("");
routeSel.onchange = renderBrief;

document.getElementById("legend").innerHTML = Object.values(CLASSES)
  .map((c) => `<div><span class="sw" style="background:${c.color}"></span>${c.label}</div>`).join("");

const slider = document.getElementById("slider");
slider.oninput = () => { t = +slider.value; render(); };

let timer = null;
document.getElementById("play").onclick = (e) => {
  if (timer) { clearInterval(timer); timer = null; e.target.textContent = "▶"; return; }
  e.target.textContent = "❚❚";
  if (t >= STEPS) t = 0;
  timer = setInterval(() => {
    t++; slider.value = t; render();
    if (t >= STEPS) { clearInterval(timer); timer = null; e.target.textContent = "▶"; }
  }, 350);
};

render();
