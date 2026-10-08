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
let map;
let routeLayers = [];
let comparisonChart;
let lifetimeChart;
let engineChart;
const RAIL_API = "https://v6.db.transport.rest";
let lastRoute;

function formatTime(hours) {
  const minutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} Std. ` : ""}${minutes % 60} Min.`;
}
function euro(value) { return `${value.toFixed(2).replace(".", ",")} €`; }
function number(id, fallback) { return Math.max(0, Number($(id).value) || fallback); }
function estimateGermanNet(gross) {
  const allowance = 12000;
  const taxable = Math.max(0, gross - allowance);
  let incomeTax = 0;
  if (taxable <= 17000) incomeTax = taxable * .14;
  else if (taxable <= 68000) incomeTax = 2380 + (taxable - 17000) * .24;
  else if (taxable <= 277000) incomeTax = 14620 + (taxable - 68000) * .42;
  else incomeTax = 102580 + (taxable - 277000) * .45;
  const pension = gross * .093;
  const unemployment = gross * .013;
  const health = gross * .0855;
  const care = gross * .024;
  const solidarity = incomeTax > 18000 ? incomeTax * .055 : 0;
  return Math.max(0, gross - incomeTax - solidarity - pension - unemployment - health - care);
}
function calculateSalary() {
  const gross = number("annual-salary", 50000);
  const weeklyHours = Math.max(1, number("weekly-hours", 40));
  const netAnnual = estimateGermanNet(gross);
  const netHourly = netAnnual / (weeklyHours * 52);
  $("hourly-wage").value = netHourly.toFixed(2);
  $("salary-result").textContent = `Geschätztes Netto: ${euro(netAnnual)} / Jahr · Stundenlohn: ${euro(netHourly)} / Std.`;
  if (lastRoute) calculateComparison();
}
function selectedVehicle() {
  const category = $("auto-profile").value;
  const fuelKey = $("auto-fuel").value;
  const age = number("auto-age", 5);
  const power = number("auto-power", 150);
  const base = VEHICLE_BASE[category];
  const fuel = FUEL[fuelKey];
  return { ...base, fuel: fuelKey, fuelLabel: fuel.label, efficiency: fuel.efficiency, mass: base.mass + (power - 150) * .35, cda: base.cda + Math.max(0, power - 200) * .0003, age, power, price: fuel.price, unit: fuel.unit, density: fuel.density };
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
  return { totalHours: input.distance / speed + energyCost / input.hourlyWage, energyCost, consumption: input.vehicle.fuel === "electric" ? energyKwhPerKm * 100 : energyKwhPerKm * 100 / input.vehicle.density };
}
function readAutoInput(distance) {
  const vehicle = selectedVehicle();
  return { vehicle, hourlyWage: Math.max(.01, number("hourly-wage", 25)), distance, energyPrice: number("auto-energy-price", vehicle.price), conditions: $("conditions").value };
}
function updateVehicleUI(resetPrice = true) {
  const vehicle = selectedVehicle();
  $("auto-age-value").textContent = `${vehicle.age} ${vehicle.age === 1 ? "Jahr" : "Jahre"}`;
  $("auto-power-value").textContent = `${vehicle.power} PS`;
  $("vehicle-description").textContent = `${vehicle.label} · ${vehicle.fuelLabel} · ${vehicle.power} PS · ${vehicle.age} Jahre`;
  $("auto-summary").textContent = `${vehicle.label} · ${vehicle.fuelLabel} · ${vehicle.power} PS · ${vehicle.age} Jahre`;
  $("auto-energy-label").textContent = vehicle.fuel === "electric" ? "Strompreis" : `${vehicle.fuelLabel}preis`;
  $("auto-energy-unit").textContent = vehicle.fuel === "electric" ? "€/kWh" : "€/l";
  if (resetPrice) $("auto-energy-price").value = vehicle.price;
  $("vehicle-category").value = vehicle.category || $("auto-profile").value;
  $("vehicle-fuel").value = vehicle.fuel;
  $("vehicle-age").value = vehicle.age;
  $("vehicle-power").value = vehicle.power;
  $("energy-price").value = $("auto-energy-price").value;
}
function renderSpeedChart(input) {
  const speeds = Array.from({ length: 11 }, (_, i) => 80 + i * 10);
  const results = speeds.map((speed) => calculateAtSpeed(speed, input));
  const bestIndex = results.reduce((best, result, i) => result.totalHours < results[best].totalHours ? i : best, 0);
  const best = results[bestIndex];
  $("optimal-speed").textContent = speeds[bestIndex];
  $("consumption").textContent = `${best.consumption.toFixed(2).replace(".", ",")} ${input.vehicle.unit}/100 km`;
  $("trip-cost").textContent = euro(best.energyCost + input.distance * (.045 + input.vehicle.mass / 100000));
  const fixed = 420 + input.vehicle.power * .9 + (input.vehicle.fuel === "electric" ? 0 : 100 + input.vehicle.power * 1.5);
  const depreciation = Math.max(700, (input.vehicle.fuel === "electric" ? 3500 : 2800) * Math.max(.55, 1 - input.vehicle.age * .018) + input.vehicle.power * 3);
  $("annual-cost").textContent = euro(fixed + depreciation);
  $("fixed-cost").textContent = `${euro(fixed)} / Jahr`;
  $("depreciation-cost").textContent = `${euro(depreciation)} / Jahr`;
  $("wear-cost").textContent = euro(input.distance * (.045 + input.vehicle.mass / 100000));
  if (lifetimeChart) lifetimeChart.destroy();
  lifetimeChart = new Chart($("lifetime-chart"), { type: "line", data: { labels: speeds, datasets: [{ data: results.map((r) => r.totalHours * 60), borderColor: "#ef8350", backgroundColor: "rgba(239,131,80,.12)", borderWidth: 3, pointRadius: 3, tension: .35, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => ` ${formatTime(item.raw / 60)} Lebenszeit` } } }, scales: { x: { title: { display: true, text: "Geschwindigkeit (km/h)" }, grid: { display: false } }, y: { title: { display: true, text: "Lebenszeit" }, ticks: { callback: (value) => formatTime(value / 60) } } } } });
  renderEngineChart(input.vehicle, speeds[bestIndex]);
}
function renderEngineChart(vehicle, optimalSpeed) {
  const canvas = $("engine-chart");
  const parent = canvas.parentElement;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = { left: 56, right: 20, top: 20, bottom: 42 };
  const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
  const minRpm = 900; const maxRpm = 6000;
  const x = (rpm) => pad.left + (rpm - minRpm) / (maxRpm - minRpm) * plotW;
  const y = (load) => pad.top + (1 - load / 110) * plotH;
  const targetRpm = vehicle.fuel === "electric" ? 1600 : 2600;
  const efficiency = (rpm, load) => Math.max(.12, (vehicle.fuel === "electric" ? .91 : .39) - Math.abs(rpm - targetRpm) / 4200 * .16 - Math.max(0, (45 - load) / 100) * .22);
  ctx.clearRect(0, 0, width, height);
  for (let rpm = minRpm; rpm < maxRpm; rpm += 100) for (let load = 0; load < 110; load += 5) {
    const value = efficiency(rpm + 50, load + 2.5);
    ctx.fillStyle = `rgb(${Math.round(230 - value * 170)}, ${Math.round(78 + value * 150)}, 90)`;
    ctx.fillRect(x(rpm), y(load + 5), x(rpm + 100) - x(rpm) + 1, y(load) - y(load + 5) + 1);
  }
  ctx.fillStyle = "#17231f"; ctx.font = "11px DM Sans";
  ctx.fillText("Motorlast (%)", 7, 16); ctx.fillText("Drehzahl (U/min)", width / 2 - 42, height - 8);
  for (let load = 0; load <= 100; load += 20) { ctx.fillStyle = "#71807b"; ctx.fillText(`${load}`, 28, y(load) + 4); }
  for (let rpm = 1000; rpm <= 6000; rpm += 1000) { ctx.fillStyle = "#71807b"; ctx.fillText(`${rpm}`, x(rpm) - 12, height - 23); }
  ctx.fillStyle = "#12513e"; ctx.beginPath(); ctx.arc(x(targetRpm), y(68), 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#12513e"; ctx.font = "600 11px DM Sans"; ctx.fillText(`Sweet Spot · ${optimalSpeed} km/h`, x(targetRpm) + 11, y(68) - 9);
  engineChart = canvas;
}
async function geocode(query) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("Geocoding nicht erreichbar.");
  const places = await response.json();
  if (!places.length) throw new Error(`Ort nicht gefunden: ${query}`);
  return { lat: Number(places[0].lat), lon: Number(places[0].lon), name: places[0].display_name };
}
function offsetLine(coords, amount) {
  return coords.map(([lon, lat], index) => {
    const next = coords[Math.min(index + 1, coords.length - 1)];
    const dx = next[1] - lat;
    const dy = next[0] - lon;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    return [lat + (-dy / length) * amount, lon + (dx / length) * amount];
  });
}
function stationPoint(location) {
  const point = location?.location || location;
  return point && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude))
    ? [Number(point.latitude), Number(point.longitude)]
    : null;
}
function journeyPoints(journey) {
  const points = [];
  const add = (item) => {
    const point = stationPoint(item);
    if (point && (!points.length || points[points.length - 1][0] !== point[0] || points[points.length - 1][1] !== point[1])) points.push(point);
  };
  add(journey?.legs?.[0]?.origin);
  (journey?.legs || []).forEach((leg) => {
    add(leg.origin);
    (leg.stopovers || []).forEach((stopover) => add(stopover.stop));
    add(leg.destination);
  });
  return points;
}
function journeyDuration(journey, fallbackHours) {
  const departure = Date.parse(journey?.departure || journey?.legs?.[0]?.departure || "");
  const legs = journey?.legs || [];
  const arrival = Date.parse(journey?.arrival || legs[legs.length - 1]?.arrival || "");
  return Number.isFinite(departure) && Number.isFinite(arrival) && arrival > departure ? (arrival - departure) / 3600000 : fallbackHours;
}
function journeyFare(journey) {
  const amount = journey?.price?.amount ?? journey?.price?.value;
  const parsed = Number(amount);
  return Number.isFinite(parsed) && parsed >= 0 ? (parsed > 500 ? parsed / 100 : parsed) : null;
}
function journeyHasTrainType(journey, type) {
  return (journey?.legs || []).some((leg) => {
    const product = String(leg?.line?.product || leg?.line?.name || "").toLowerCase();
    return type === "ice" ? product.includes("ice") : ["regional", "regio", "re", "rb", "s", "tram", "bus"].some((value) => product.includes(value));
  });
}
async function railLocation(query) {
  const response = await fetch(`${RAIL_API}/locations?query=${encodeURIComponent(query)}&results=5&fuzzy=true`);
  if (!response.ok) throw new Error("Bahn-Haltestellen konnten nicht geladen werden.");
  const locations = await response.json();
  const station = locations.find((location) => location.type === "station" || location.type === "stop") || locations[0];
  if (!station?.id) throw new Error(`Kein Bahnhof gefunden: ${query}`);
  return station;
}
async function fetchRailJourneys(startQuery, endQuery) {
  const [from, to] = await Promise.all([railLocation(startQuery), railLocation(endQuery)]);
  const response = await fetch(`${RAIL_API}/journeys?from=${encodeURIComponent(from.id)}&to=${encodeURIComponent(to.id)}&results=8&transfers=3&nationalExpress=true&national=true&regional=true&suburban=true&tram=true&bus=false&ferry=false`);
  if (!response.ok) throw new Error("Bahnverbindungen konnten nicht geladen werden.");
  const data = await response.json();
  const journeys = data.journeys || [];
  const ice = journeys.find((journey) => journeyHasTrainType(journey, "ice")) || journeys[0];
  const regio = journeys.find((journey) => journeyHasTrainType(journey, "regional")) || journeys[1] || journeys[0];
  if (!ice && !regio) throw new Error("Keine Bahnverbindung gefunden.");
  return { from, to, ice, regio };
}
function railDetail(journey) {
  if (!journey) return "Keine API-Verbindung verfügbar";
  const lines = (journey.legs || []).map((leg) => leg.line?.name || leg.line?.product).filter(Boolean);
  const transfers = Math.max(0, (journey.legs || []).filter((leg) => leg.line).length - 1);
  return `${transfers} ${transfers === 1 ? "Umstieg" : "Umstiege"} · ${lines.slice(0, 4).join(" · ") || "Bahn"}`;
}
function drawRoutes(start, end, geometry, rail) {
  if (!map) {
    map = L.map("route-map", { preferCanvas: true }).setView([start.lat, start.lon], 7);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: "© Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende",
      maxZoom: 19
    }).addTo(map);
  }
  routeLayers.forEach((layer) => layer.remove());
  const coords = geometry.coordinates;
  const auto = L.geoJSON(geometry, { style: { color: "#197458", weight: 5, opacity: .9 } }).addTo(map);
  const icePoints = rail?.ice ? journeyPoints(rail.ice) : [];
  const regioPoints = rail?.regio ? journeyPoints(rail.regio) : [];
  const ice = icePoints.length > 1
    ? L.polyline(icePoints, { color: "#ef8350", weight: 5, opacity: .9 }).addTo(map)
    : null;
  const regio = regioPoints.length > 1
    ? L.polyline(regioPoints, { color: "#8667a9", weight: 5, opacity: .9 }).addTo(map)
    : null;
  $("ice-legend").hidden = !ice;
  $("regio-legend").hidden = !regio;
  const markers = L.layerGroup([L.marker([start.lat, start.lon]).bindPopup("Start"), L.marker([end.lat, end.lon]).bindPopup("Ziel")]).addTo(map);
  routeLayers = [auto, ice, regio, markers].filter(Boolean);
  map.fitBounds(auto.getBounds(), { padding: [24, 24] });
  map.invalidateSize();
}
async function calculateRoute(event) {
  event.preventDefault();
  const status = $("route-status");
  status.textContent = "Orte werden gesucht und drei Routenkorridore werden berechnet …";
  try {
    const [start, end] = await Promise.all([geocode($("route-start").value), geocode($("route-end").value)]);
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`);
    if (!response.ok) throw new Error("Routenservice nicht erreichbar.");
    const data = await response.json();
    if (data.code !== "Ok" || !data.routes.length) throw new Error("Keine fahrbare Route gefunden.");
    lastRoute = { start, end, geometry: data.routes[0].geometry, km: data.routes[0].distance / 1000, duration: data.routes[0].duration / 3600 };
    let rail = null;
    try {
      rail = await fetchRailJourneys($("route-start").value, $("route-end").value);
      lastRoute.rail = rail;
      status.textContent = "Auto- und Bahnroute gefunden. Fahrzeiten und Umstiege stammen aus der Bahn-API …";
    } catch (railError) {
      status.textContent = `Bahn-API nicht erreichbar (${railError.message}). Auto-Route wird angezeigt; Bahnwerte sind als Näherung markiert.`;
    }
    drawRoutes(start, end, lastRoute.geometry, rail);
    status.textContent += ` ${$("route-start").value} → ${$("route-end").value} · ${lastRoute.km.toFixed(0)} km`;
    $("comparison-section").hidden = false;
    calculateComparison();
  } catch (error) {
    status.textContent = `Fehler: ${error.message} Bitte Ortsnamen präzisieren oder später erneut versuchen.`;
  }
}
function calculateComparison() {
  if (!lastRoute) return;
  const directionFactor = $("trip-type").value === "round-trip" ? 2 : 1;
  const distance = lastRoute.km * directionFactor;
  const hourlyWage = Math.max(.01, number("hourly-wage", 25));
  const days = number("commute-days", 5);
  const buffer = number("rail-buffer", 15) / 60 * directionFactor;
  const autoInput = readAutoInput(distance);
  const speeds = Array.from({ length: 11 }, (_, i) => 80 + i * 10);
  const autoResults = speeds.map((speed) => ({ speed, result: calculateAtSpeed(speed, autoInput) }));
  const auto = autoResults.reduce((best, item) => item.result.totalHours < best.result.totalHours ? item : best);
  const roadHours = lastRoute.duration * directionFactor;
  const railDistance = lastRoute.km * 1.08 * directionFactor;
  const iceHours = railDistance / number("ice-speed", 190) + .25 * directionFactor + buffer;
  const regioHours = railDistance / number("regio-speed", 85) + .45 * directionFactor + buffer;
  const rail = lastRoute.rail;
  const iceApiHours = rail?.ice ? journeyDuration(rail.ice, iceHours / directionFactor) * directionFactor : iceHours;
  const regioApiHours = rail?.regio ? journeyDuration(rail.regio, regioHours / directionFactor) * directionFactor : regioHours;
  const iceFare = rail?.ice ? journeyFare(rail.ice) : null;
  const regioFare = rail?.regio ? journeyFare(rail.regio) : null;
  const iceTicket = iceFare ?? number("ice-cost", 38);
  const regioTicket = regioFare ?? number("regio-cost", 8);
  const iceSource = rail?.ice ? `DB-Fahrplandaten · ${railDetail(rail.ice)}${iceFare === null ? " · Preis nicht verfügbar" : ""}` : "Näherung wegen Bahn-API-Ausfall";
  const regioSource = rail?.regio ? `DB-Fahrplandaten · ${railDetail(rail.regio)}${regioFare === null ? " · Preis nicht verfügbar" : ""}` : "Näherung wegen Bahn-API-Ausfall";
  const autoWear = distance * (.045 + autoInput.vehicle.mass / 100000);
  const autoCost = auto.result.energyCost + autoWear + number("parking-cost", 4);
  const modes = [
    { key: "auto", label: "Auto", icon: "↗", hours: distance / auto.speed + autoCost / hourlyWage, travel: distance / auto.speed, cost: autoCost, detail: `Sweet Spot ${auto.speed} km/h · ${roadHours ? formatTime(roadHours) : "Routezeit"}`, color: "#197458" },
    { key: "ice", label: "ICE", icon: "▣", hours: iceApiHours * (1 - number("ice-use", 70) / 100) + iceTicket / hourlyWage, travel: iceApiHours, cost: iceTicket, detail: `${formatTime(iceApiHours)} Reisezeit · ${$("ice-use").value}% nutzbar · ${iceSource}`, color: "#ef8350" },
    { key: "regio", label: "Regionalzug", icon: "▣", hours: regioApiHours * (1 - number("regio-use", 55) / 100) + regioTicket / hourlyWage, travel: regioApiHours, cost: regioTicket, detail: `${formatTime(regioApiHours)} Reisezeit · ${$("regio-use").value}% nutzbar · ${regioSource}`, color: "#8667a9" }
  ];
  const winner = modes.reduce((best, mode) => mode.hours < best.hours ? mode : best);
  $("winner-callout").textContent = `${winner.label} bindet am wenigsten Lebenszeit · ${formatTime(winner.hours)} pro Pendeltag`;
  $("comparison-grid").innerHTML = modes.map((mode) => `<article class="comparison-card ${mode.key === winner.key ? "winner" : ""}"><h3>${mode.icon} ${mode.label}${mode.key === winner.key ? " · Empfehlung" : ""}</h3><div class="big-time">${formatTime(mode.hours)} <small>Lebenszeit</small></div><dl><dt>Reisezeit</dt><dd>${formatTime(mode.travel)}</dd><dt>Kostenarbeitszeit</dt><dd>${formatTime(mode.cost / hourlyWage)}</dd><dt>Pro Woche</dt><dd>${formatTime(mode.hours * days)}</dd></dl><small>${mode.detail}</small></article>`).join("");
  if (comparisonChart) comparisonChart.destroy();
  comparisonChart = new Chart($("comparison-chart"), { type: "bar", data: { labels: modes.map((mode) => mode.label), datasets: [{ data: modes.map((mode) => mode.hours), backgroundColor: modes.map((mode) => mode.color), borderRadius: 6, maxBarThickness: 70 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => ` ${formatTime(item.raw)} pro Pendeltag` } } }, scales: { y: { beginAtZero: true, title: { display: true, text: "Stunden Lebenszeit" }, ticks: { callback: (value) => `${value} h` } }, x: { grid: { display: false } } } } });
  renderSpeedChart(autoInput);
}
document.addEventListener("DOMContentLoaded", () => {
  updateVehicleUI();
  $("salary-toggle").addEventListener("click", () => {
    const panel = $("salary-calculator");
    panel.hidden = !panel.hidden;
    $("salary-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) calculateSalary();
  });
  ["annual-salary", "weekly-hours"].forEach((id) => $(id).addEventListener("input", calculateSalary));
  $("route-form").addEventListener("submit", calculateRoute);
  $("swap-route").addEventListener("click", () => { const start = $("route-start").value; $("route-start").value = $("route-end").value; $("route-end").value = start; });
  $("compare-button").addEventListener("click", calculateComparison);
  const refreshVehicle = (source, target, resetPrice = false) => {
    if (target) $(target).value = $(source).value;
    updateVehicleUI(resetPrice);
    if (lastRoute) calculateComparison();
  };
  $("auto-profile").addEventListener("change", () => refreshVehicle("auto-profile", "vehicle-category"));
  $("auto-fuel").addEventListener("change", () => { updateVehicleUI(); if (lastRoute) calculateComparison(); });
  $("auto-age").addEventListener("input", () => refreshVehicle("auto-age", "vehicle-age"));
  $("auto-power").addEventListener("input", () => refreshVehicle("auto-power", "vehicle-power"));
  $("auto-energy-price").addEventListener("input", () => { $("energy-price").value = $("auto-energy-price").value; if (lastRoute) calculateComparison(); });
  ["vehicle-category", "vehicle-fuel", "vehicle-age", "vehicle-power", "energy-price"].forEach((id) => $(id).addEventListener("input", () => {
    const mirror = { "vehicle-category": "auto-profile", "vehicle-fuel": "auto-fuel", "vehicle-age": "auto-age", "vehicle-power": "auto-power", "energy-price": "auto-energy-price" }[id];
    refreshVehicle(id, mirror, false);
  }));
  ["hourly-wage", "commute-days", "trip-type", "rail-buffer", "conditions", "parking-cost", "ice-speed", "ice-cost", "ice-use", "regio-speed", "regio-cost", "regio-use"].forEach((id) => $(id).addEventListener("input", () => { if (id.endsWith("-use")) $(`${id}-value`).textContent = `${$(id).value} %`; if (lastRoute) calculateComparison(); }));
  document.querySelector(".expert-panel").addEventListener("toggle", (event) => { if (event.target.open && lastRoute) renderSpeedChart(readAutoInput(lastRoute.km * ($("trip-type").value === "round-trip" ? 2 : 1))); });
  window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
});
