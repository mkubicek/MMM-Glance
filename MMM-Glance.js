/* global Module, Glance */
Module.register("MMM-Glance", {
  defaults: {
    location: { latitude: 47.3769, longitude: 8.5417, label: "Zurich" },
    skyTitle: null,             // null: "Sky over <location.label>", or "Sky" without a label
    cards: ["sky", "lake", "upcoming", "wine"],
    rotateInterval: 30000,
    fadeSpeed: 400,             // every fade is ~60 fps compositing on the Pi; keep it short
    width: 460,
    quietHours: null,           // e.g. { from: "23:00", to: "06:00" } while the screen is off
    lake: { station: "mythenquai", title: "Zürichsee · Mythenquai" },
    sonarr: null,
    radarr: null,
    grapy: null,
    upcomingEntries: 5
  },

  getScripts: function() { return [this.file("glance.js")]; },
  getStyles: function() { return ["MMM-Glance.css"]; },

  start: function() {
    this.feed = {};
    this.index = 0;
    this.sendSocketNotification("GLANCE_START", {
      quietHours: this.config.quietHours,
      lake: this.config.cards.indexOf("lake") !== -1 ? this.config.lake : null,
      sonarr: this.config.sonarr, radarr: this.config.radarr, grapy: this.config.grapy
    });
    var self = this;
    this.rotation = setInterval(function() { self.rotate(); }, this.config.rotateInterval);
  },

  socketNotificationReceived: function(name, payload) {
    if (name !== "GLANCE_DATA") return;
    var before = this.available().length;
    this.feed = payload;
    if (payload.wine && payload.wine.image && (!this.bottle || this.bottle.id !== payload.wine.productId)) {
      this.cutout(payload.wine.productId, payload.wine.image);
    }
    // Only redraw immediately when a card became available; otherwise the next rotation picks it up.
    if (this.available().length !== before) this.updateDom(0);
  },

  rotate: function() {
    if (Glance.inQuietHours(Date.now(), this.config.quietHours)) return;
    var cards = this.available();
    if (cards.length < 2 && this.lastRendered === cards[0]) return;
    this.index = (this.index + 1) % Math.max(cards.length, 1);
    this.updateDom(this.config.fadeSpeed);
  },

  available: function() {
    var d = this.feed || {}, now = Date.now();
    return this.config.cards.filter(function(card) {
      if (card === "sky") return true;
      if (card === "lake") return d.lake && now - d.lake.latest.at < 6 * 3600000;
      if (card === "upcoming") return d.upcoming && (d.upcoming.episodes.length || d.upcoming.movies.length);
      if (card === "wine") return !!d.wine;
      return false;
    });
  },

  /*
   * Shop bottle shots sit on white, which glows on a mirror. Once per wine, flood-fill
   * the near-white background from the edges to transparent (labels inside survive)
   * and crop to the bottle.
   */
  cutout: function(id, src) {
    var self = this, img = new Image();
    img.onload = function() {
      var w = img.naturalWidth, h = img.naturalHeight, canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      var data = ctx.getImageData(0, 0, w, h), px = data.data, seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
      var head = 0, tail = 0;
      function light(i) { return Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); }
      function push(i) { if (!seen[i] && light(i) > 222) { seen[i] = 1; queue[tail++] = i; } }
      for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (head < tail) {
        var i = queue[head++], cx = i % w;
        px[i * 4 + 3] = Math.max(0, Math.min(255, (248 - light(i)) * 10));
        if (cx > 0) push(i - 1);
        if (cx < w - 1) push(i + 1);
        if (i >= w) push(i - w);
        if (i < w * (h - 1)) push(i + w);
      }
      var x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (var j = 0; j < w * h; j++) {
        if (px[j * 4 + 3] > 40) {
          var jx = j % w, jy = (j - jx) / w;
          if (jx < x0) x0 = jx; if (jx > x1) x1 = jx; if (jy < y0) y0 = jy; if (jy > y1) y1 = jy;
        }
      }
      if (x1 < 0) return;
      ctx.putImageData(data, 0, 0);
      var out = document.createElement("canvas");
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      // One decoded <img>, moved into each rebuilt card, instead of decoding the PNG every rotation.
      var bottle = new Image();
      bottle.className = "gl-bottle"; bottle.alt = ""; bottle.src = out.toDataURL("image/png");
      self.bottle = { id: id, img: bottle };
      if (self.lastRendered === "wine") self.updateDom(0);
    };
    img.src = src;
  },

  /* ---------- DOM helpers ---------- */

  el: function(tag, cls, text, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  },

  svg: function(tag, attrs, parent) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs).forEach(function(k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  },

  getDom: function() {
    var cards = this.available();
    if (this.index >= cards.length) this.index = 0;
    var card = cards[this.index];
    this.lastRendered = card;

    var root = this.el("div", "glance");
    root.style.width = this.config.width + "px";
    var header = this.el("div", "gl-header", null, root);
    var title = this.el("span", "gl-title", null, header);
    var dots = this.el("span", "gl-dots", null, header);
    cards.forEach(function(c, i) { this.el("span", "gl-dot" + (i === this.index ? " gl-active" : ""), null, dots); }, this);
    var body = this.el("div", "gl-body gl-" + card, null, root);

    title.textContent = this["render_" + card](body);
    return root;
  },

  /* ---------- Sky: sun, daylight, moon, what's next on the calendar ---------- */

  render_sky: function(body) {
    var G = Glance, now = Date.now(), lat = this.config.location.latitude, lon = this.config.location.longitude;
    var today = G.sunTimes(now, lat, lon), yesterday = G.sunTimes(now - G.DAY, lat, lon);
    var length = today.set - today.rise, delta = length - (yesterday.set - yesterday.rise);

    var top = this.el("div", "gl-sky-top", null, body);
    var times = this.el("div", "gl-sun-times", null, top);
    this.sunTime(times, "Sunrise", today.rise);
    this.sunTime(times, "Sunset", today.set);
    var day = this.el("div", "gl-daylight", null, top);
    this.el("div", "gl-big-sm", G.duration(length), day);
    this.el("div", "gl-muted", G.signedMinSec(delta) + " vs yesterday", day);

    body.appendChild(this.sunArc(now, lat, lon));

    var moon = G.moonState(now), full = G.nextMoonPhase(now, true), fresh = G.nextMoonPhase(now, false);
    var next = full < fresh ? { at: full, name: "Full moon" } : { at: fresh, name: "New moon" };
    var row = this.el("div", "gl-sky-row", null, body);
    row.appendChild(this.moonIcon(moon));
    this.el("span", null, G.moonName(moon) + " · " + Math.round(moon.illumination * 100) + "%", row);
    this.el("span", "gl-muted gl-right", next.name + " " + this.when(next.at), row);

    var notes = [], change = G.nextClockChange(now), holiday = G.nextHoliday(now);
    if (change && change.at - now < 21 * G.DAY) {
      notes.push("Clocks go " + (change.forward ? "forward" : "back") + " " + this.when(change.at, true) +
        (change.forward ? " · −1 h sleep" : " · +1 h sleep"));
    }
    if (holiday) notes.push(holiday.name + " " + (holiday.inDays === 0 ? "today" : holiday.inDays === 1 ? "tomorrow" : "in " + holiday.inDays + " days"));
    // One note per line: two of them never fit side by side in 460px.
    notes.forEach(function(note) { this.el("div", "gl-note", note, body); }, this);
    return G.skyTitle(this.config.skyTitle, this.config.location);
  },

  sunTime: function(parent, label, at) {
    var cell = this.el("div", "gl-sun-time", null, parent);
    this.el("div", "gl-label", label, cell);
    this.el("div", "gl-big-sm", at ? Glance.clock(at) : "—", cell);
  },

  sunArc: function(now, lat, lon) {
    var w = this.config.width, h = 36, horizon = 24, scale = (horizon - 3) / 70;
    var start = Glance.localMidnight(Glance.localDay(now)), span = Glance.localMidnight(Glance.localDay(now) + 1) - start;
    var root = this.svg("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, "class": "gl-arc" });
    var pts = [];
    for (var i = 0; i <= 96; i++) {
      var t = start + i / 96 * span;
      pts.push([i / 96 * w, horizon - Glance.sunAltitude(t, lat, lon) * scale]);
    }
    var d = pts.map(function(p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join("");
    var defs = this.svg("defs", {}, root);
    this.svg("rect", { x: 0, y: 0, width: w, height: horizon }, this.svg("clipPath", { id: "gl-above" }, defs));
    this.svg("path", { d: d, "class": "gl-arc-night" }, root);
    this.svg("path", { d: d, "class": "gl-arc-day", "clip-path": "url(#gl-above)" }, root);
    this.svg("line", { x1: 0, x2: w, y1: horizon, y2: horizon, "class": "gl-horizon" }, root);
    var x = (now - start) / span * w;
    var alt = Glance.sunAltitude(now, lat, lon);
    this.svg("circle", { cx: x.toFixed(1), cy: (horizon - alt * scale).toFixed(1), r: 3.5, "class": alt > -0.833 ? "gl-sun" : "gl-sun gl-sun-down" }, root);
    return root;
  },

  moonIcon: function(state) {
    var r = 7, s = 2 * r + 2;
    var root = this.svg("svg", { width: s, height: s, viewBox: (-r - 1) + " " + (-r - 1) + " " + s + " " + s, "class": "gl-moon" });
    this.svg("circle", { cx: 0, cy: 0, r: r, "class": "gl-moon-dark" }, root);
    var k = Math.cos(2 * Math.PI * state.phase), rx = Math.abs(k) * r, waxing = state.phase < 0.5;
    var outer = waxing ? 1 : 0, inner = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
    this.svg("path", { d: "M0," + (-r) + "A" + r + "," + r + " 0 0 " + outer + " 0," + r +
      "A" + rx.toFixed(2) + "," + r + " 0 0 " + inner + " 0," + (-r) + "Z", "class": "gl-moon-lit" }, root);
    return root;
  },

  when: function(at, dateOnly) {
    var G = Glance, today = G.localDay(Date.now()), day = G.localDay(at);
    var label = day - today < 2 ? G.dayLabel(day, today).toLowerCase() : G.dayLabel(day, today);
    if (day - today >= 2 && day - today < 7) {
      var d = new Date(day * G.DAY);
      label += " " + d.getUTCDate() + "." + (d.getUTCMonth() + 1) + ".";
    }
    return dateOnly ? label : label + " " + G.clock(at);
  },

  /* ---------- Lake ---------- */

  render_lake: function(body) {
    var lake = this.feed.lake, r = lake.latest, G = Glance;
    var top = this.el("div", "gl-lake-top", null, body);
    var water = this.el("div", "gl-water", null, top);
    this.el("div", "gl-big", r.water.toFixed(1) + "°", water);
    var trend = lake.change24h;
    this.el("div", "gl-muted", "water" + (trend === null ? "" : trend === 0 ? " · steady" :
      " · " + (trend > 0 ? "▲ " : "▼ ") + Math.abs(trend).toFixed(1) + "° in 24 h"), water);

    var facts = this.el("div", "gl-facts", null, top);
    if (r.air !== null) this.fact(facts, "Air", r.air.toFixed(1) + "°");
    if (r.wind !== null) {
      var kmh = Math.round(r.wind * 3.6), gust = r.gust === null ? null : Math.round(r.gust * 3.6);
      this.fact(facts, "Wind", (r.bft !== null ? Math.round(r.bft) + " Bft " : "") + G.compass(r.dir) +
        " · " + kmh + (gust !== null && gust > kmh ? "–" + gust : "") + " km/h");
    }
    this.fact(facts, "Measured", G.clock(r.at));

    body.appendChild(this.sparkline(lake.series));
    return G.lakeTitle(this.config.lake);
  },

  fact: function(parent, label, text) {
    var row = this.el("div", "gl-fact", null, parent);
    this.el("span", "gl-label", label, row);
    this.el("span", null, text, row);
  },

  sparkline: function(series) {
    var w = this.config.width, h = 44, pad = 4;
    var root = this.svg("svg", { width: w, height: h + 12, viewBox: "0 0 " + w + " " + (h + 12), "class": "gl-spark" });
    if (series.length < 2) return root;
    var t0 = series[0][0], t1 = series[series.length - 1][0];
    var lo = Infinity, hi = -Infinity;
    series.forEach(function(p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    var mid = (lo + hi) / 2, span = Math.max(hi - lo, 1);
    function x(t) { return (t - t0) / Math.max(t1 - t0, 1) * (w - 44); }
    function y(v) { return pad + (h - 2 * pad) * (1 - ((v - mid) / span + 0.5)); }
    // Midnight gridlines give the three days a rhythm without labels.
    for (var day = Glance.localDay(t0) + 1; day <= Glance.localDay(t1); day++) {
      var mx = x(Glance.localMidnight(day)).toFixed(1);
      this.svg("line", { x1: mx, x2: mx, y1: pad, y2: h - pad, "class": "gl-grid" }, root);
    }
    var d = series.map(function(p, i) { return (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); }).join("");
    this.svg("path", { d: d, "class": "gl-spark-line" }, root);
    var last = series[series.length - 1];
    this.svg("circle", { cx: x(last[0]).toFixed(1), cy: y(last[1]).toFixed(1), r: 2.5, "class": "gl-spark-dot" }, root);
    var hiText = this.svg("text", { x: w, y: y(hi) + 4, "class": "gl-spark-label" }, root); hiText.textContent = hi.toFixed(1) + "°";
    var loText = this.svg("text", { x: w, y: y(lo) + 4, "class": "gl-spark-label" }, root); loText.textContent = lo.toFixed(1) + "°";
    var cap = this.svg("text", { x: 0, y: h + 11, "class": "gl-spark-caption" }, root); cap.textContent = "3 days";
    return root;
  },

  /* ---------- Coming up ---------- */

  render_upcoming: function(body) {
    var G = Glance, now = Date.now(), today = G.localDay(now), u = this.feed.upcoming;
    var rows = G.comingUp(u.episodes, u.movies, now, this.config.upcomingEntries);
    var lastDay = null;
    rows.forEach(function(r) {
      var row = this.el("div", "gl-up-row" + (r.day !== lastDay && lastDay !== null ? " gl-up-newday" : ""), null, body);
      this.el("span", "gl-up-day", r.day !== lastDay ? G.dayLabel(r.day, today) : "", row);
      this.el("span", "gl-up-title", r.title, row);
      this.el("span", "gl-up-detail", (r.ready ? "✓ " : "") + r.detail, row);
      lastDay = r.day;
    }, this);
    return "Coming up";
  },

  /* ---------- Wine of the day ---------- */

  render_wine: function(body) {
    var w = this.feed.wine;
    if (this.bottle && this.bottle.id === w.productId) body.appendChild(this.bottle.img);
    var text = this.el("div", "gl-wine-text", null, body);
    this.el("div", "gl-wine-name", w.name, text);
    this.el("div", "gl-muted", [w.producer, w.vintage].filter(Boolean).join(" · "), text);
    this.el("div", "gl-muted", [w.region, w.country].filter(Boolean).join(", ") + (w.grapes.length ? " · " + w.grapes.join(", ") : ""), text);
    if (w.notes.length) this.el("div", "gl-wine-notes", w.notes.join(" · "), text);
    var foot = this.el("div", "gl-wine-foot", null, text);
    this.el("span", "gl-wine-price", "CHF " + w.price.toFixed(2), foot);
    this.el("span", "gl-muted", w.shop + (w.otherShops ? " +" + w.otherShops : ""), foot);
    this.el("span", "gl-wine-score", w.rating + " pts", foot);
    return "Wine of the day";
  }
});
