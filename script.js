/* ============================================================
   HEAT WATCH — app logic
   ============================================================ */

/* ---------- 1. SUPABASE CONFIG ----------------------------------
   Fill these in with your project's values:
   Supabase Dashboard → Project Settings → API
------------------------------------------------------------------ */
const SUPABASE_URL = "https://bfwchpvlnnudpuayburn.supabase.co"; // e.g. https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_ehjoC_TprGYJEhDS7TP2Ig_6TKP54Hb";

let supabase = null;
let participantId = null;

function initSupabase() {
  if (!SUPABASE_URL.startsWith("http") || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith("YOUR_")) {
    console.warn("[HeatWatch] Supabase is not configured yet — fill in SUPABASE_URL and SUPABASE_ANON_KEY in script.js. Metrics tracking is disabled.");
    return;
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* Get or create this browser's participant row, stored locally so
   repeat visits reuse the same participant_id. */
async function initParticipant() {
  if (!supabase) return;

  const stored = localStorage.getItem("hhws_participant_id");

  if (stored) {
    // Confirm the row still exists before trusting it.
    const { data, error } = await supabase
      .from("participant_metrics")
      .select("participant_id")
      .eq("participant_id", stored)
      .maybeSingle();

    if (data && !error) {
      participantId = stored;
      return;
    }
  }

  // No valid stored id — create a fresh participant row.
  const { data, error } = await supabase
    .from("participant_metrics")
    .insert({})
    .select("participant_id")
    .single();

  if (error) {
    console.error("[HeatWatch] Could not create participant row:", error.message);
    return;
  }

  participantId = data.participant_id;
  localStorage.setItem("hhws_participant_id", participantId);
}

async function incrementMetric(metricName) {
  if (!supabase || !participantId) return;
  const { error } = await supabase.rpc("increment_metric", {
    p_id: participantId,
    metric_name: metricName,
  });
  if (error) console.error(`[HeatWatch] increment_metric(${metricName}) failed:`, error.message);
}

/* ---------- 2. NAVIGATION / SECTION TAKEOVER --------------------- */
const tabButtons = document.querySelectorAll(".tab-btn");
const pages = document.querySelectorAll(".page");
const visitedInfo = { info: false };

function showSection(id) {
  pages.forEach((p) => p.classList.toggle("active", p.id === id));
  tabButtons.forEach((b) => {
    const isActive = b.dataset.section === id;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  if (id === "info" && !visitedInfo.info) {
    visitedInfo.info = true;
    incrementMetric("messages_opened");
  }

  if (id === "resources") {
    // Leaflet needs a nudge to size correctly the first time its
    // container becomes visible.
    setTimeout(() => { if (map) map.invalidateSize(); }, 60);
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => showSection(btn.dataset.section));
});

/* ---------- 3. WEATHER (Open-Meteo — no API key required) ------- */
const LA_LAT = 34.0522;
const LA_LON = -118.2437;

const WEATHER_CODES = {
  0: ["Clear sky", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Foggy", "🌫️"], 48: ["Foggy", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
  61: ["Light rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌦️"], 82: ["Violent showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};

let liveConditions = null; // last real fetch, so "reset" can restore it

async function loadWeather() {
  const dateLabel = document.getElementById("dateLabel");
  dateLabel.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LA_LAT}&longitude=${LA_LON}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const c = json.current;
    const [desc, icon] = WEATHER_CODES[c.weather_code] || ["Clear", "☀️"];

    liveConditions = {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      wind: Math.round(c.wind_speed_10m),
      desc, icon,
    };
    renderConditions(liveConditions, false);
  } catch (err) {
    console.error("[HeatWatch] Weather fetch failed:", err);
    liveConditions = { temp: 78, feelsLike: 80, humidity: 45, wind: 6, desc: "Clear sky", icon: "☀️" };
    renderConditions(liveConditions, false);
  }
}

function recommendationFor(temp) {
  if (temp >= 100) return "Dangerous heat today. Limit time outdoors, drink water constantly, and check on neighbors who may be vulnerable.";
  if (temp >= 90) return "It's hot out there. Stay hydrated, seek shade during midday hours, and take it easy on strenuous outdoor activity.";
  if (temp >= 80) return "Warm and pleasant. Keep water on hand if you're spending time outside this afternoon.";
  return "Enjoy the day — conditions are comfortable. Stay hydrated as always.";
}

function renderConditions(c, isSimulated) {
  document.getElementById("tempValue").textContent = c.temp;
  document.getElementById("conditionIcon").textContent = c.icon;
  document.getElementById("conditionText").textContent = `${c.desc} in Los Angeles`;
  document.getElementById("feelsLikeValue").textContent = `${c.feelsLike}°F`;
  document.getElementById("humidityValue").textContent = `${c.humidity}%`;
  document.getElementById("windValue").textContent = `${c.wind} mph`;
  document.getElementById("recommendationText").textContent = recommendationFor(c.temp);

  const statusBanner = document.getElementById("statusBanner");
  const statusText = document.getElementById("statusText");
  const warningPanel = document.getElementById("warningPanel");

  if (isSimulated) {
    statusBanner.classList.add("danger");
    statusText.textContent = "EXCESSIVE HEAT WARNING IN EFFECT — take precautions now";
    warningPanel.hidden = false;
  } else {
    statusBanner.classList.remove("danger");
    statusText.textContent = c.temp >= 90
      ? "HEAT ADVISORY — stay hydrated and limit sun exposure"
      : "CONDITIONS NORMAL — no heat advisory in effect";
    warningPanel.hidden = true;
  }
}

/* ---------- 4. SIMULATE HEAT EVENT ------------------------------- */
const simulateBtn = document.getElementById("simulateBtn");
let simulated = false;

simulateBtn.addEventListener("click", async () => {
  simulated = !simulated;
  document.body.classList.toggle("heat-event", simulated);
  simulateBtn.classList.toggle("is-live", simulated);

  if (simulated) {
    simulateBtn.innerHTML = `<span class="simulate-icon">✕</span> Reset Conditions`;
    renderConditions(
      { temp: 103, feelsLike: 111, humidity: 18, wind: 12, desc: "Excessive heat", icon: "🥵" },
      true
    );
    incrementMetric("heat_events_simulated");
  } else {
    simulateBtn.innerHTML = `<span class="simulate-icon">⚠</span> Simulate Heat Event`;
    renderConditions(liveConditions || { temp: 78, feelsLike: 80, humidity: 45, wind: 6, desc: "Clear sky", icon: "☀️" }, false);
  }

  showSection("today");
});

/* ---------- 5. COMMUNITY RESOURCES MAP --------------------------- */
const RESOURCES = [
  {
    name: "Pan Pacific Park Cooling Center",
    type: "Cooling Center · Highlighted",
    lat: 34.0765, lon: -118.3607,
    desc: "Air-conditioned recreation center open to the public during heat alerts. Free water available.",
    highlighted: true,
  },
  {
    name: "MLK Jr. Community Center",
    type: "Cooling Center",
    lat: 34.0059, lon: -118.2878,
    desc: "South LA community hub with a designated cooling room and senior check-in services.",
  },
  {
    name: "Panorama Recreation Center",
    type: "Cooling Center",
    lat: 34.2270, lon: -118.4420,
    desc: "San Fernando Valley cooling center with extended hours during heat advisories.",
  },
  {
    name: "Boyle Heights Senior Center",
    type: "Senior Resource Center",
    lat: 34.0334, lon: -118.2075,
    desc: "Priority resource for older adults, offering AC, hydration stations, and wellness checks.",
  },
];

let map = null;

function makeMarkerIcon(highlighted) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${highlighted ? 22 : 16}px; height:${highlighted ? 22 : 16}px;
      border-radius:50%;
      background:${highlighted ? "#C1432B" : "#2F7A78"};
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(27,42,56,.35);
    "></div>`,
    iconSize: [highlighted ? 22 : 16, highlighted ? 22 : 16],
    iconAnchor: [highlighted ? 11 : 8, highlighted ? 11 : 8],
  });
}

function initMap() {
  map = L.map("map", { scrollWheelZoom: false }).setView([34.06, -118.30], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  RESOURCES.forEach((r) => {
    const marker = L.marker([r.lat, r.lon], { icon: makeMarkerIcon(r.highlighted) }).addTo(map);
    marker.bindPopup(
      `<b>${r.name}</b><br>${r.type}<br><span style="color:#555">${r.desc}</span>`
    );
    if (r.highlighted) {
      marker.openPopup();
    }
    marker.on("click", () => incrementMetric("resources_clicked"));
  });
}

function renderResourceList() {
  const list = document.getElementById("resourceList");
  list.innerHTML = "";
  RESOURCES.forEach((r) => {
    const card = document.createElement("div");
    card.className = "resource-card" + (r.highlighted ? " highlighted" : "");
    card.innerHTML = `
      <h4>${r.name}</h4>
      <span class="r-type">${r.type}</span>
      <p>${r.desc}</p>
      <button class="r-cta">View on map</button>
    `;
    card.querySelector(".r-cta").addEventListener("click", () => {
      map.flyTo([r.lat, r.lon], 13, { duration: 0.8 });
      incrementMetric("resources_clicked");
    });
    list.appendChild(card);
  });
}

/* ---------- 6. INIT ------------------------------------------------ */
(async function init() {
  initSupabase();
  await initParticipant();
  loadWeather();
  initMap();
  renderResourceList();
})();
