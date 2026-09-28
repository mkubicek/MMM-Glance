"use strict";
// Preview of the real module front end with synthetic data: made-up shows, movies and wine,
// a generated lake series and a drawn bottle. No Sonarr, Radarr, grapy, tecdottir or
// MagicMirror needed: `npm run demo`, then open http://localhost:3470.
//
// The synthetic payloads go through the same glance.js parsers the node_helper uses.
const http = require("http");
const fs = require("fs");
const path = require("path");
const Glance = require("../glance");

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/* ---------- Lake: three days of 10-minute readings, shaped like a tecdottir response ---------- */

function lake(now) {
  const end = Math.floor(now / (10 * MINUTE)) * 10 * MINUTE - 10 * MINUTE, rows = [];
  for (let t = end - 3 * DAY; t <= end; t += 10 * MINUTE) {
    const daysAgo = (end - t) / DAY, hour = (t / HOUR + 2) % 24; // CEST
    const water = 16.4 + 0.42 * daysAgo + 0.28 * Math.sin(2 * Math.PI * (hour - 10) / 24) + 0.04 * Math.sin(t / 2.3e6);
    const air = 13.5 + 3.8 * Math.sin(2 * Math.PI * (hour - 9) / 24) + 0.3 * Math.sin(t / 5.1e6);
    const wind = 2.2 + 1.1 * Math.sin(t / 7.7e6);
    const ok = (v) => ({ value: Math.round(v * 10) / 10, status: "ok" });
    rows.push({
      timestamp: new Date(t).toISOString(),
      values: {
        water_temperature: ok(water), air_temperature: ok(air), wind_speed_avg_10min: ok(wind),
        wind_gust_max_10min: ok(wind * 1.9), wind_force_avg_10min: ok(wind < 1.6 ? 1 : wind < 3.4 ? 2 : 3),
        wind_direction: ok(230 + 20 * Math.sin(t / 9e6))
      }
    });
  }
  const parsed = Glance.parseLake({ ok: true, result: rows });
  // Same hourly thinning as node_helper.js.
  parsed.series = parsed.series.filter((p, i, all) => i === all.length - 1 || new Date(p[0]).getUTCMinutes() === 0);
  return parsed;
}

/* ---------- Coming up: fictional Sonarr / Radarr calendar entries ---------- */

function upcoming(now) {
  const today = Glance.localMidnight(Glance.localDay(now));
  const at = (days, hh, mm) => new Date(today + days * DAY + (hh || 0) * HOUR + (mm || 0) * MINUTE).toISOString();
  const ep = (title, s, e, when, hasFile) => ({ airDateUtc: when, series: { title }, seasonNumber: s, episodeNumber: e, monitored: true, hasFile: !!hasFile });
  const sonarr = [
    ep("Northern Lines", 2, 7, at(0, 3), true),
    ep("Tidewater", 1, 9, at(1, 21)),
    ep("Tidewater", 1, 10, at(1, 21, 50)),
    ep("Signal & Static", 3, 5, at(2, 22)),
    ep("The Lamplighters", 1, 1, at(4, 20))
  ];
  const radarr = [
    { title: "Glass Orchard", digitalRelease: at(3), monitored: true },
    { title: "Paper Moons", physicalRelease: at(9), digitalRelease: at(-40), monitored: true }
  ];
  return {
    episodes: Glance.episodesFromSonarr(sonarr),
    movies: Glance.moviesFromRadarr(radarr, now - DAY, now + 22 * DAY)
  };
}

/* ---------- Wine of the day: a fictional bottle in grapy's explorer shape ---------- */

function wine(now) {
  const page = { items: [{
    wine_id: 1, name: "Colline des Merles Pinot Noir", producer: "Domaine des Trois Chênes", vintage: 2022,
    country: "Switzerland", region: "Valais", grapes: ["Pinot Noir"], style: "red",
    rating: "87.40", rating_count: 412, rating_evidence: "established", match_confidence: 96,
    sensory: [{ label: "Cherry" }, { label: "Violet" }, { label: "Forest floor" }],
    offers: [
      { price_per_750ml: "21.50", source_name: "Cave Exemple", product_id: 2, has_image: true },
      { price_per_750ml: "18.90", source_name: "Demo Cellars", product_id: 1, has_image: true },
      { price_per_750ml: "19.95", source_name: "Vins Fictifs", product_id: 3, has_image: true }
    ]
  }] };
  const pick = Glance.wineOfTheDay(Glance.winePool(page, 80), Glance.localDay(now));
  pick.image = "/bottle.svg"; // the helper sends a data: URL; same-origin keeps the canvas untainted
  return pick;
}

// A drawn bottle on white, so the front end's background cut-out runs just as with a shop photo.
function bottle() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="800" viewBox="0 0 240 800">
<rect width="240" height="800" fill="#fff"/>
<defs><linearGradient id="glass" x1="0" x2="1"><stop offset="0" stop-color="#14261b"/><stop offset=".35" stop-color="#2f5a3f"/><stop offset=".55" stop-color="#1c3526"/><stop offset="1" stop-color="#0d1a12"/></linearGradient></defs>
<path d="M100 40 H140 V250 C140 300 200 320 200 380 V760 Q200 780 180 780 H60 Q40 780 40 760 V380 C40 320 100 300 100 250 Z" fill="url(#glass)"/>
<rect x="97" y="30" width="46" height="120" rx="6" fill="#6d1f2a"/>
<rect x="97" y="138" width="46" height="8" fill="#a8454f"/>
<rect x="52" y="470" width="136" height="190" rx="4" fill="#efe6d0"/>
<rect x="60" y="478" width="120" height="174" rx="2" fill="none" stroke="#8a6d3b" stroke-width="2"/>
<text x="120" y="530" text-anchor="middle" font-family="Georgia, serif" font-size="17" fill="#3b2a14" letter-spacing="1">COLLINE</text>
<text x="120" y="554" text-anchor="middle" font-family="Georgia, serif" font-size="17" fill="#3b2a14" letter-spacing="1">DES MERLES</text>
<path d="M92 574 H148" stroke="#8a6d3b" stroke-width="1.5"/>
<text x="120" y="600" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#6d1f2a">2022</text>
<text x="120" y="632" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#7a6a50" letter-spacing="3">DEMO</text>
<path d="M60 250 Q62 300 70 330" stroke="#fff" stroke-opacity=".12" stroke-width="6" fill="none"/>
<rect x="52" y="400" width="10" height="340" rx="5" fill="#fff" fill-opacity=".08"/>
</svg>`;
}

const FILES = {
  "/": ["demo/index.html", "text/html"],
  "/demo.js": ["demo/demo.js", "text/javascript"],
  "/glance.js": ["glance.js", "text/javascript"],
  "/MMM-Glance.js": ["MMM-Glance.js", "text/javascript"],
  "/MMM-Glance.css": ["MMM-Glance.css", "text/css"]
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/data") {
    const now = +url.searchParams.get("now") || Date.now();
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ lake: lake(now), upcoming: upcoming(now), wine: wine(now) }));
  }
  if (url.pathname === "/bottle.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(bottle());
  }
  const file = FILES[url.pathname];
  if (!file) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  res.setHeader("Content-Type", file[1]);
  res.end(fs.readFileSync(path.join(__dirname, "..", file[0])));
}).listen(Number(process.env.PORT || 3470), "127.0.0.1", () => {
  console.log("MMM-Glance demo: http://localhost:" + (process.env.PORT || 3470));
});
