"use strict";
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const https = require("https");
const NodeHelper = require("node_helper");
const Glance = require("./glance");

const MINUTE = 60000;
// MagicMirror sends config.js to every browser on the LAN; API keys live here instead (mode 600).
const SECRETS = path.join(os.homedir(), ".config", "MMM-Glance", "secrets.json");

function secrets() {
  try { return JSON.parse(fs.readFileSync(SECRETS, "utf8")); } catch (e) { return {}; }
}

function get(url, headers, binary) {
  return new Promise(function(resolve, reject) {
    const client = url.indexOf("https:") === 0 ? https : http;
    const req = client.get(url, { headers: Object.assign({ "User-Agent": "MMM-Glance" }, headers || {}), timeout: 20000 }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const body = Buffer.concat(chunks);
        if (res.statusCode !== 200) return reject(new Error(url.split("?")[0] + " → HTTP " + res.statusCode));
        if (binary) return resolve({ body: body, type: res.headers["content-type"] || "image/jpeg" });
        try { resolve(JSON.parse(body.toString("utf8"))); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", function() { req.abort(); });
    req.on("error", reject);
  });
}

function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

/*
 * One timer drives every source; each source has its own interval and back-off.
 * Nothing is fetched during quiet hours (screen off), and the display only gets a
 * message when something it shows actually changed.
 */
module.exports = NodeHelper.create({
  start: function() {
    this.options = null;
    this.timer = null;
    this.state = { lake: null, lakeAt: null, upcoming: null, upcomingAt: null, wine: null, wineAt: null };
    this.sources = {};
    this.winePool = [];
    this.images = {};
    this.lastSent = "";
  },

  socketNotificationReceived: function(name, payload) {
    if (name !== "GLANCE_START" || !payload) return;
    const local = secrets();
    this.options = Object.assign({}, payload, {
      sonarr: payload.sonarr || local.sonarr || null,
      radarr: payload.radarr || local.radarr || null,
      grapy: payload.grapy || local.grapy || null
    });
    this.lastSent = "";
    if (!this.timer) {
      const self = this;
      this.timer = setInterval(function() { self.tick(); }, MINUTE);
    }
    this.tick();
  },

  source: function(key, interval, run) {
    const now = Date.now(), s = this.sources[key] || (this.sources[key] = { at: 0, failures: 0, pending: false });
    if (s.pending) return;
    const wait = s.failures ? Math.min(interval, MINUTE * Math.pow(2, s.failures)) : interval;
    if (now - s.at < wait) return;
    s.at = now; s.pending = true;
    const self = this;
    run.call(this).then(function() { s.failures = 0; }, function(error) {
      s.failures = Math.min(s.failures + 1, 6);
      console.error("[MMM-Glance] " + key + ": " + error.message);
    }).then(function() { s.pending = false; self.send(); });
  },

  tick: function() {
    const o = this.options;
    if (!o) return;
    if (Glance.inQuietHours(Date.now(), o.quietHours)) return;
    if (o.lake) this.source("lake", 10 * MINUTE, this.fetchLake);
    if (o.sonarr || o.radarr) this.source("upcoming", 60 * MINUTE, this.fetchUpcoming);
    if (o.grapy) this.source("wine", 6 * 60 * MINUTE, this.fetchWines);
    // The wine of the day changes at midnight without a new fetch.
    this.pickWine().then(this.send.bind(this), function() {});
  },

  fetchLake: function() {
    const self = this, o = this.options.lake;
    const url = "https://tecdottir.metaodi.ch/measurements/" + encodeURIComponent(o.station || "mythenquai") +
      "?startDate=" + isoDate(Date.now() - 3 * 864e5) + "&sort=timestamp_cet%20asc&limit=600";
    return get(url).then(function(body) {
      const lake = Glance.parseLake(body);
      // A 3-day sparkline needs one point per hour, not per 10 minutes.
      lake.series = lake.series.filter(function(p, i, all) { return i === all.length - 1 || new Date(p[0]).getUTCMinutes() === 0; });
      self.state.lake = lake; self.state.lakeAt = Date.now();
    });
  },

  fetchUpcoming: function() {
    const self = this, o = this.options, now = Date.now();
    const start = isoDate(now - 864e5), tvEnd = isoDate(now + 8 * 864e5), movieEnd = isoDate(now + 22 * 864e5);
    const tv = o.sonarr ? get(o.sonarr.url + "/api/v3/calendar?includeSeries=true&start=" + start + "&end=" + tvEnd,
      { "X-Api-Key": o.sonarr.apiKey }) : Promise.resolve([]);
    const movies = o.radarr ? get(o.radarr.url + "/api/v3/calendar?start=" + start + "&end=" + movieEnd,
      { "X-Api-Key": o.radarr.apiKey }) : Promise.resolve([]);
    return Promise.all([tv, movies]).then(function(r) {
      self.state.upcoming = {
        episodes: Glance.episodesFromSonarr(r[0]),
        movies: Glance.moviesFromRadarr(r[1], Date.parse(start), Date.parse(movieEnd))
      };
      self.state.upcomingAt = Date.now();
    });
  },

  fetchWines: function() {
    const self = this, g = this.options.grapy;
    const url = g.url + "/api/explorer/wines?sort=rating&limit=100&price_max=" + (g.priceMax || 25) +
      "&rating_min=" + (g.ratingMin || 80);
    return get(url).then(function(page) {
      const pool = Glance.winePool(page, g.minConfidence || 80);
      if (!pool.length) throw new Error("no wines match");
      self.winePool = pool;
      self.state.wine = null;
      return self.pickWine();
    });
  },

  pickWine: function() {
    const self = this, g = this.options.grapy;
    if (!g || !this.winePool.length) return Promise.resolve();
    const wine = Glance.wineOfTheDay(this.winePool, Glance.localDay(Date.now()));
    if (this.state.wine && this.state.wine.id === wine.id) return Promise.resolve();
    const cached = this.images[wine.productId];
    const image = cached !== undefined ? Promise.resolve(cached) :
      get(g.url + "/api/images/product/" + wine.productId, null, true).then(function(r) {
        return "data:" + r.type + ";base64," + r.body.toString("base64");
      }, function() { return null; });
    return image.then(function(src) {
      self.images = {}; self.images[wine.productId] = src;
      wine.image = src;
      self.state.wine = wine; self.state.wineAt = Date.now();
    });
  },

  send: function() {
    const snapshot = JSON.stringify(this.state);
    if (snapshot === this.lastSent) return;
    this.lastSent = snapshot;
    this.sendSocketNotification("GLANCE_DATA", this.state);
  }
});
