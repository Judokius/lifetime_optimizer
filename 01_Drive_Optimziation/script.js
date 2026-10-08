const $ = (id) => document.getElementById(id);
const VEHICLE_BASE = {
  small: { label: "Kleinwagen", mass: 1120, cda: .62, rolling: .012 },
  compact: { label: "Kompaktklasse", mass: 1400, cda: .63, rolling: .012 },
  wagon: { label: "Kombi", mass: 1580, cda: .67, rolling: .012 },
  suv: { label: "SUV", mass: 1850, cda: .86, rolling: .014 },
  sport: { label: "Sportwagen", mass: 1680, cda: .75, rolling: .013 }
};
const FUEL = {
  petrol: { label: "Benzin", efficiency: .29, price: 1.78, unit: "l", density: 8.9 },
  diesel: { label: "Diesel", efficiency: .36, price: 1.72, unit: "l", density: 9.8 },
  electric: { label: "Elektro", efficiency: .88, price: .32, unit: "kWh", density: 1 }
};
let lifetimeChart;
let engineChart;
let map;
let routeLayer;

function formatTime(hours) {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} Std. ` : ""}${minutes % 60} Min.`;
}
function euro(value) { return `${value.toFixed(2).replace(".", ",")} €`; }
function selectedVehicle() {
  const category = $("vehicle-category").value;
  const fuelKey = $("vehicle-fuel").value;
  const age = Number($("vehicle-age").value);
  const power = Number($("vehicle-power").value);
  const base = VEHICLE_BASE[category];
  const fuel = FUEL[fuelKey];
  return {
    ...base, fuel: fuelKey, fuelLabel: fuel.label, efficiency: fuel.efficiency,
    mass: base.mass + (power - 150) * .35, cda: base.cda + Math.max(0, power - 200) * .0003,
    age, power, price: fuel.price, unit: fuel.unit, density: fuel.density
  };
}
function readInputs() {
  const vehicle = selectedVehicle();
  return {
    vehicle,
    hourlyWage: Math.max(.01, Number($("hourly-wage").value) || 25),
    distance: Math.max(1, Number($("distance").value) || 1) * ($("trip-type").value === "round-trip" ? 2 : 1),
    energyPrice: Math.max(0, Number($("energy-price").value) || vehicle.price),
    conditions: $("conditions").value
  };
}
function calculateAtSpeed(speed, input) {
  const v = speed / 3.6;
  const weather = input.conditions === "traffic" ? 1.08 : input.conditions === "headwind" ? 1.16 : 1;
  const effectiveV = v + (input.conditions === "headwind" ? 15 / 3.6 : 0);
  const aero = .5 * 1.225 * input.vehicle.cda * effectiveV ** 2;
  const rolling = input.vehicle.mass * 9.81 * input.vehicle.rolling;
  const roadPower = (aero + rolling) * v * weather;
  const accessory = input.vehicle.fuel === "electric" ? 800 : 1100;
  const load = Math.max(.18, Math.min(1, roadPower / 65000));
  const penalty = input.vehicle.fuel === "electric" ? 1 + (1 - load) * .08 : 1 + (1 - load) * .38;
  const efficiency = input.vehicle.efficiency / penalty;
  const energyKwhPerKm = (roadPower + accessory) / efficiency / 1000 / speed;
  const pricedUnitPerKm = input.vehicle.fuel === "electric" ? energyKwhPerKm : energyKwhPerKm / input.vehicle.density;
  const energyCost = pricedUnitPerKm * input.distance * input.energyPrice;
  return { totalHours: input.distance / speed + energyCost / input.hourlyWage, energyCost, consumption: input.vehicle.fuel === "electric" ? energyKwhPerKm * 100 : energyKwhPerKm * 100 / input.vehicle.density, power: roadPower };
}
function updateVehicleUI(resetPrice = true) {
  const vehicle = selectedVehicle();
  $("age-value").textContent = `${vehicle.age} ${vehicle.age === 1 ? "Jahr" : "Jahre"}`;
  $("power-value").textContent = `${vehicle.power} PS`;
  $("vehicle-description").textContent = `${VEHICLE_BASE[$("vehicle-category").value].label} · ${vehicle.fuelLabel} · ${vehicle.power} PS · ${vehicle.age} Jahre`;
  $("energy-label").textContent = vehicle.fuel === "electric" ? "Strompreis" : `${vehicle.fuelLabel}preis`;
  $("energy-unit").textContent = vehicle.fuel === "electric" ? "€/kWh" : "€/l";
  if (resetPrice) $("energy-price").value = vehicle.price;
}
function renderLifetimeChart(speeds, results, optimal) {
  if (lifetimeChart) lifetimeChart.destroy();
  lifetimeChart = new Chart($("lifetime-chart"), {
    type: "line", data: { labels: speeds, datasets: [{ data: results.map((r) => r.totalHours * 60), borderColor: "#f0834f", backgroundColor: "rgba(240,131,79,.12)", borderWidth: 3, pointRadius: 3, tension: .35, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => ` ${formatTime(item.raw / 60)} Lebenszeit` } } }, scales: { x: { title: { display: true, text: "Geschwindigkeit (km/h)" }, grid: { display: false } }, y: { title: { display: true, text: "Lebenszeit" }, grid: { color: "#edf1ef" }, ticks: { callback: (v) => formatTime(v / 60) } } } }
  });
}
function renderEngineChart(vehicle, optimalSpeed) {
  const canvas = $("engine-chart");
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = { left: 56, right: 20, top: 20, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minRpm = 900;
  const maxRpm = 6000;
  const x = (rpm) => pad.left + (rpm - minRpm) / (maxRpm - minRpm) * plotW;
  const y = (load) => pad.top + (1 - load / 110) * plotH;
  const targetRpm = vehicle.fuel === "electric" ? 1600 : 2600;
  const efficiency = (rpm, load) => {
    const base = vehicle.fuel === "electric" ? .91 : .39;
    return Math.max(.12, base - Math.abs(rpm - targetRpm) / 4200 * .16 - Math.max(0, (45 - load) / 100) * .22);
  };
  ctx.clearRect(0, 0, width, height);
  for (let rpm = minRpm; rpm < maxRpm; rpm += 100) {
    for (let load = 0; load < 110; load += 5) {
      const value = efficiency(rpm + 50, load + 2.5);
      const red = Math.round(230 - value * 170);
      const green = Math.round(78 + value * 150);
      ctx.fillStyle = `rgb(${red}, ${green}, 90)`;
      ctx.fillRect(x(rpm), y(load + 5), x(rpm + 100) - x(rpm) + 1, y(load) - y(load + 5) + 1);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,.86)";
  ctx.lineWidth = 1.4;
  [0.2, 0.25, 0.3, 0.35].forEach((level) => {
    ctx.beginPath();
    for (let rpm = minRpm; rpm <= maxRpm; rpm += 30) {
      const ratio = Math.max(.03, Math.min(.96, (level - (vehicle.fuel === "electric" ? .91 : .39) + Math.abs(rpm - targetRpm) / 4200 * .16) / .22));
      const load = 45 - ratio * 100;
      const px = x(rpm);
      const py = y(load);
      if (rpm === minRpm) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  });
  ctx.fillStyle = "#17231f";
  ctx.font = "11px DM Sans";
  ctx.fillText("Motorlast (%)", 7, 16);
  ctx.fillText("Drehzahl (U/min)", width / 2 - 42, height - 8);
  for (let load = 0; load <= 100; load += 20) { ctx.fillStyle = "#71807b"; ctx.fillText(`${load}`, 28, y(load) + 4); }
  for (let rpm = 1000; rpm <= 6000; rpm += 1000) { ctx.fillStyle = "#71807b"; ctx.fillText(`${rpm}`, x(rpm) - 12, height - 23); }
  const markerLoad = vehicle.fuel === "electric" ? 72 : 68;
  ctx.fillStyle = "#12513e";
  ctx.beginPath(); ctx.arc(x(targetRpm), y(markerLoad), 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#12513e"; ctx.font = "600 11px DM Sans";
  ctx.fillText(`Sweet Spot · ${optimalSpeed} km/h`, x(targetRpm) + 11, y(markerLoad) - 9);
  engineChart = { canvas };
}
function updateCosts(input, best) {
  const ageFactor = Math.max(.55, 1 - input.vehicle.age * .018);
  const insurance = 420 + input.vehicle.power * .9;
  const tax = input.vehicle.fuel === "electric" ? 0 : 100 + input.vehicle.power * (input.vehicle.fuel === "diesel" ? 1.9 : 1.2);
  const depreciation = Math.max(700, (input.vehicle.fuel === "electric" ? 3500 : 2800) * ageFactor + input.vehicle.power * 3);
  const fixed = insurance + tax;
  const wearPerKm = .045 + input.vehicle.mass / 100000;
  const wear = input.distance * wearPerKm;
  $("fixed-cost").textContent = `${euro(fixed)} / Jahr`;
  $("depreciation-cost").textContent = `${euro(depreciation)} / Jahr`;
  $("annual-cost").textContent = `${euro(fixed + depreciation)} / Jahr`;
  $("wear-cost").textContent = euro(wear);
  $("total-trip-cost").textContent = euro(best.energyCost + wear);
}
function calculate() {
  const input = readInputs();
  const speeds = Array.from({ length: 11 }, (_, i) => 80 + i * 10);
  const results = speeds.map((speed) => calculateAtSpeed(speed, input));
  const bestIndex = results.reduce((best, result, i) => result.totalHours < results[best].totalHours ? i : best, 0);
  const speed = speeds[bestIndex];
  const best = results[bestIndex];
  $("optimal-speed").textContent = speed;
  $("total-time").textContent = formatTime(best.totalHours);
  $("energy-cost").textContent = euro(best.energyCost);
  $("consumption").textContent = `${best.consumption.toFixed(2).replace(".", ",")} ${input.vehicle.unit}/100 km`;
  $("result-lead").textContent = `Bei ${speed} km/h opferst du insgesamt ${formatTime(best.totalHours)} Lebenszeit für diese Fahrt.`;
  $("insight-text").textContent = `Die Energie kostet dich ${formatTime(best.energyCost / input.hourlyWage)} Arbeitszeit. Die Empfehlung ist eine Näherung und variiert mit Verkehr, Wind und tatsächlicher Motorcharakteristik.`;
  renderLifetimeChart(speeds, results, speed);
  renderEngineChart(input.vehicle, speed);
  updateCosts(input, best);
  return { input, speed, best };
}
async function geocode(query) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Lebenszeit-Optimierer/1.0" } });
  if (!response.ok) throw new Error("Geocoding nicht erreichbar.");
  const places = await response.json();
  if (!places.length) throw new Error(`Ort nicht gefunden: ${query}`);
  return { lat: Number(places[0].lat), lon: Number(places[0].lon), name: places[0].display_name };
}
async function calculateRoute(event) {
  event.preventDefault();
  const status = $("route-status");
  status.textContent = "Orte werden gesucht und Route wird berechnet …";
  $("route-results").hidden = true;
  try {
    const [start, end] = await Promise.all([geocode($("route-start").value), geocode($("route-end").value)]);
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true`);
    if (!response.ok) throw new Error("Routenservice nicht erreichbar.");
    const data = await response.json();
    if (data.code !== "Ok" || !data.routes.length) throw new Error("Keine fahrbare Route gefunden.");
    const route = data.routes[0];
    const km = route.distance / 1000;
    const routeInput = readInputs();
    routeInput.distance = km;
    const routeOptimal = [100, 110, 120, 130, 140].map((s) => ({ s, r: calculateAtSpeed(s, routeInput) })).sort((a, b) => a.r.totalHours - b.r.totalHours)[0];
    const hours = route.duration / 3600;
    const railKm = km * 1.08;
    $("route-car-time").textContent = `${formatTime(hours)} laut Straßenroute`;
    $("route-car-detail").textContent = `${km.toFixed(0)} km · Autobahn-Empfehlung: ${routeOptimal.s} km/h`;
    $("route-car-life").textContent = `Lebenszeitkosten: ${formatTime(routeOptimal.r.totalHours)} (davon ${formatTime(routeOptimal.r.energyCost / routeInput.hourlyWage)} Arbeitszeit für Energie)`;
    const iceHours = railKm / 160 + .35;
    const regioHours = railKm / 85 + .55;
    const iceCost = Math.max(19.90, railKm * .16);
    const ticketLife = iceCost / routeInput.hourlyWage;
    $("rail-ice-time").textContent = formatTime(iceHours);
    $("rail-ice-cost").textContent = `ICE-Näherung: ${euro(iceCost)} · ohne Live-Tarif`;
    $("rail-ice-life").textContent = `Lebenszeitbindung: ${formatTime(iceHours + ticketLife)} (inkl. Ticketarbeitszeit)`;
    $("rail-regio-time").textContent = formatTime(regioHours);
    $("rail-regio-cost").textContent = "Deutschlandticket: 63,00 € / Monat · keine Einzelpreisberechnung";
    $("rail-regio-life").textContent = `Lebenszeitbindung: ${formatTime(regioHours)} · Ticket pauschal monatlich`;
    $("route-results").hidden = false;
    status.textContent = `${$("route-start").value} → ${$("route-end").value} · ${km.toFixed(0)} km Straßenroute`;
    if (!map) {
      map = L.map("route-map", { preferCanvas: true }).setView([start.lat, start.lon], 7);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        attribution: "© Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende",
        maxZoom: 19
      }).addTo(map);
    }
    map.invalidateSize();
    if (routeLayer) routeLayer.remove();
    routeLayer = L.geoJSON(route.geometry, { style: { color: "#1d7659", weight: 5, opacity: .85 } }).addTo(map);
    L.marker([start.lat, start.lon]).addTo(routeLayer).bindPopup("Start");
    L.marker([end.lat, end.lon]).addTo(routeLayer).bindPopup("Ziel");
    map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });
  } catch (error) {
    status.textContent = `Fehler: ${error.message} Bitte Ortsnamen präzisieren oder später erneut versuchen.`;
  }
}
document.addEventListener("DOMContentLoaded", () => {
  updateVehicleUI();
  calculate();
  $("optimizer-form").addEventListener("submit", (event) => { event.preventDefault(); calculate(); });
  ["trip-type", "conditions", "hourly-wage", "distance", "energy-price"].forEach((id) => $(id).addEventListener("input", calculate));
  ["vehicle-category", "vehicle-fuel"].forEach((id) => $(id).addEventListener("change", () => { updateVehicleUI(); calculate(); }));
  ["vehicle-age", "vehicle-power"].forEach((id) => $(id).addEventListener("input", () => { updateVehicleUI(false); calculate(); }));
  $("route-form").addEventListener("submit", calculateRoute);
  document.querySelectorAll('input[name="app-mode"]').forEach((input) => input.addEventListener("change", (event) => {
    $("navigation-panel").hidden = event.target.value !== "navigation";
    if (event.target.value === "navigation") $("navigation-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  window.addEventListener("resize", () => {
    if (engineChart) renderEngineChart(selectedVehicle(), Number($("optimal-speed").textContent));
    if (map) map.invalidateSize();
  });
});
