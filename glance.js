/* Shared, dependency-free Glance logic. Runs in Node 10 (helper) and the mirror's browser. */
(function(root) {
  "use strict";

  var RAD = Math.PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545;
  var TZ = "Europe/Zurich";

  /* ---------- Sun (NOAA solar position; rise/set within a minute) ---------- */

  function solar(ms) {
    var jc = (ms / DAY + J1970 - 0.5 - J2000) / 36525;
    var l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
    var m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    var e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    var c = Math.sin(RAD * m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
      Math.sin(RAD * 2 * m) * (0.019993 - 0.000101 * jc) + Math.sin(RAD * 3 * m) * 0.000289;
    var omega = RAD * (125.04 - 1934.136 * jc);
    var lambda = RAD * (l0 + c - 0.00569 - 0.00478 * Math.sin(omega));
    var eps = RAD * (23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega));
    var y = Math.pow(Math.tan(eps / 2), 2), L = RAD * l0, M = RAD * m;
    var eot = 4 / RAD * (y * Math.sin(2 * L) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * L) -
      0.5 * y * y * Math.sin(4 * L) - 1.25 * e * e * Math.sin(2 * M));
    return { dec: Math.asin(Math.sin(eps) * Math.sin(lambda)), eot: eot };
  }

  /* Sun altitude in degrees above the horizon (geometric, no refraction). */
  function sunAltitude(ms, lat, lon) {
    var s = solar(ms), minutes = ((ms % DAY) + DAY) % DAY / 60000;
    var ha = RAD * ((minutes + s.eot + 4 * lon) / 4 - 180), phi = RAD * lat;
    return Math.asin(Math.sin(phi) * Math.sin(s.dec) + Math.cos(phi) * Math.cos(s.dec) * Math.cos(ha)) / RAD;
  }

  function crossing(lo, hi, lat, lon, rising) {
    var h0 = -0.833;
    if ((sunAltitude(lo, lat, lon) - h0) * (sunAltitude(hi, lat, lon) - h0) > 0) return null;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2, above = sunAltitude(mid, lat, lon) > h0;
      if (above === rising) hi = mid; else lo = mid;
    }
    return Math.round((lo + hi) / 2);
  }

  /* Sunrise, solar noon and sunset (epoch ms) of the Europe/Zurich calendar day containing `ms`. */
  function sunTimes(ms, lat, lon) {
    var noon = localDay(ms) * DAY + 12 * 3600000 - 4 * lon * 60000;
    noon -= solar(noon).eot * 60000;
    return { noon: Math.round(noon), rise: crossing(noon - DAY / 2, noon, lat, lon, true),
      set: crossing(noon, noon + DAY / 2, lat, lon, false) };
  }

  /* ---------- Moon (Meeus ch. 49, main terms; a few minutes accuracy) ---------- */

  var SYNODIC = 29.530588861;

  function fromJulian(j) { return (j + 0.5 - J1970) * DAY; }

  function moonPhaseJde(k, full) {
    var t = k / 1236.85, e = 1 - 0.002516 * t;
    var jde = 2451550.09766 + SYNODIC * k + 0.00015437 * t * t;
    var m = RAD * (2.5534 + 29.1053567 * k), mp = RAD * (201.5643 + 385.81693528 * k);
    var f = RAD * (160.7108 + 390.67050284 * k);
    var c = full ?
      -0.40614 * Math.sin(mp) + 0.17302 * e * Math.sin(m) + 0.01614 * Math.sin(2 * mp) + 0.01043 * Math.sin(2 * f) +
        0.00734 * e * Math.sin(mp - m) - 0.00515 * e * Math.sin(mp + m) + 0.00209 * e * e * Math.sin(2 * m) :
      -0.4072 * Math.sin(mp) + 0.17241 * e * Math.sin(m) + 0.01608 * Math.sin(2 * mp) + 0.01039 * Math.sin(2 * f) +
        0.00739 * e * Math.sin(mp - m) - 0.00514 * e * Math.sin(mp + m) + 0.00208 * e * e * Math.sin(2 * m);
    return jde + c;
  }

  /* Next new or full moon after `ms`, as epoch ms. */
  function nextMoonPhase(ms, full) {
    var k = Math.floor((ms / DAY + J1970 - 0.5 - 2451550.09766) / SYNODIC) - 1;
    for (var i = 0; i < 4; i++, k++) {
      var at = fromJulian(moonPhaseJde(k + (full ? 0.5 : 0), full));
      if (at > ms) return at;
    }
    return null;
  }

  /*
   * Phase 0..1 (0 new, 0.5 full), interpolated between the true new and full moons
   * around `ms`, so "waxing" flips exactly at full moon despite uneven lunations.
   */
  function moonState(ms) {
    var nextNew = nextMoonPhase(ms, false), nextFull = nextMoonPhase(ms, true), phase;
    if (nextFull < nextNew) {
      var lastNew = nextMoonPhase(nextFull - 20 * DAY, false);
      phase = 0.5 * (ms - lastNew) / (nextFull - lastNew);
    } else {
      var lastFull = nextMoonPhase(nextNew - 20 * DAY, true);
      phase = 0.5 + 0.5 * (ms - lastFull) / (nextNew - lastFull);
    }
    return { phase: phase, illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2, waxing: phase < 0.5 };
  }

  function moonName(state) {
    var p = state.phase;
    if (p < 0.012 || p > 0.988) return "New moon";
    if (p < 0.22) return "Waxing crescent";
    if (p < 0.28) return "First quarter";
    if (p < 0.488) return "Waxing gibbous";
    if (p < 0.512) return "Full moon";
    if (p < 0.72) return "Waning gibbous";
    if (p < 0.78) return "Last quarter";
    return "Waning crescent";
  }

  /* ---------- Calendar ---------- */

  function zurichParts(ms) {
    var parts = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(new Date(ms)).forEach(function(p) { parts[p.type] = p.value; });
    return { y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour % 24, mm: +parts.minute };
  }

  /* Calendar day number (days since epoch) of the Europe/Zurich date containing `ms`. */
  function localDay(ms) {
    var p = zurichParts(ms);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY);
  }

  /* Epoch ms of the Europe/Zurich midnight that starts the given local day number. */
  function localMidnight(day) {
    var utc = day * DAY;
    return utc - zurichParts(utc).hh * 3600000;
  }

  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Math.round(Date.UTC(y, month - 1, day) / DAY);
  }

  /* Public holidays of the canton of Zurich, as local day numbers. */
  function zurichHolidays(y) {
    var e = easter(y);
    function fixed(m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY); }
    return [
      { day: fixed(1, 1), name: "New Year's Day" }, { day: fixed(1, 2), name: "Berchtold's Day" },
      { day: e - 2, name: "Good Friday" }, { day: e + 1, name: "Easter Monday" },
      { day: fixed(5, 1), name: "Labour Day" }, { day: e + 39, name: "Ascension Day" },
      { day: e + 50, name: "Whit Monday" }, { day: fixed(8, 1), name: "Swiss National Day" },
      { day: fixed(12, 25), name: "Christmas Day" }, { day: fixed(12, 26), name: "St Stephen's Day" }
    ].sort(function(a, b) { return a.day - b.day; });
  }

  function nextHoliday(ms) {
    var today = localDay(ms), y = zurichParts(ms).y;
    var list = zurichHolidays(y).concat(zurichHolidays(y + 1));
    for (var i = 0; i < list.length; i++) {
      if (list[i].day >= today) return { name: list[i].name, day: list[i].day, inDays: list[i].day - today };
    }
    return null;
  }

  /* Next EU daylight-saving switch (last Sunday of March / October, 01:00 UTC). */
  function nextClockChange(ms) {
    var y = new Date(ms).getUTCFullYear();
    function lastSunday(year, month) {
      var d = new Date(Date.UTC(year, month + 1, 0, 1));
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      return d.getTime();
    }
    var candidates = [
      { at: lastSunday(y, 2), forward: true }, { at: lastSunday(y, 9), forward: false },
      { at: lastSunday(y + 1, 2), forward: true }
    ];
    for (var i = 0; i < candidates.length; i++) if (candidates[i].at > ms) return candidates[i];
    return null;
  }

  /* ---------- Lake (tecdottir, Wasserschutzpolizei Zürich) ---------- */

  function value(row, key) {
    var v = row && row.values && row.values[key];
    return v && v.status === "ok" && typeof v.value === "number" ? v.value : null;
  }

  function parseLake(body) {
    if (!body || !body.ok || !Array.isArray(body.result) || !body.result.length) throw new Error("no lake data");
    var rows = body.result.map(function(r) {
      return { at: Date.parse(r.timestamp), water: value(r, "water_temperature"), air: value(r, "air_temperature"),
        wind: value(r, "wind_speed_avg_10min"), gust: value(r, "wind_gust_max_10min"),
        bft: value(r, "wind_force_avg_10min"), dir: value(r, "wind_direction") };
    }).filter(function(r) { return isFinite(r.at); }).sort(function(a, b) { return a.at - b.at; });
    var latest = null;
    for (var i = rows.length - 1; i >= 0 && !latest; i--) if (rows[i].water !== null) latest = rows[i];
    if (!latest) throw new Error("no water temperature");
    var dayAgo = null;
    rows.forEach(function(r) {
      if (r.water !== null && Math.abs(r.at - (latest.at - DAY)) <= 30 * 60000) dayAgo = r;
    });
    return {
      latest: latest,
      change24h: dayAgo ? Math.round((latest.water - dayAgo.water) * 10) / 10 : null,
      series: rows.filter(function(r) { return r.water !== null; }).map(function(r) { return [r.at, r.water]; })
    };
  }

  function compass(deg) {
    if (deg === null || !isFinite(deg)) return "";
    var names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  }

  /* ---------- Coming up (Sonarr / Radarr v3 calendars) ---------- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function episodesFromSonarr(list) {
    return (Array.isArray(list) ? list : []).filter(function(e) {
      return e && e.monitored !== false && e.airDateUtc && e.series;
    }).map(function(e) {
      return { at: Date.parse(e.airDateUtc), title: e.series.title,
        detail: "S" + pad2(e.seasonNumber) + "E" + pad2(e.episodeNumber), ready: !!e.hasFile, kind: "tv" };
    }).filter(function(e) { return isFinite(e.at); });
  }

  /* One row per movie, dated by whichever home release lands inside the window first. */
  function moviesFromRadarr(list, from, to) {
    var rows = [];
    (Array.isArray(list) ? list : []).forEach(function(m) {
      if (!m || m.monitored === false) return;
      var options = [["digitalRelease", "Digital"], ["physicalRelease", "Blu-ray"]];
      for (var i = 0; i < options.length; i++) {
        var at = Date.parse(m[options[i][0]]);
        if (isFinite(at) && at >= from && at < to) {
          rows.push({ at: at, title: m.title, detail: options[i][1], ready: !!m.hasFile, kind: "movie" });
          return;
        }
      }
    });
    return rows;
  }

  /*
   * Merge, drop anything before today, then keep at most one row per show per day
   * (a double episode reads as "S05E03–04").
   */
  function comingUp(episodes, movies, now, limit) {
    var today = localDay(now), byKey = {}, rows = [];
    episodes.concat(movies).sort(function(a, b) { return a.at - b.at || (a.title < b.title ? -1 : 1); }).forEach(function(r) {
      var day = localDay(r.at);
      if (day < today) return;
      var key = day + "|" + r.title;
      var prior = byKey[key];
      if (prior && r.kind === "tv" && prior.kind === "tv") {
        prior.detail = prior.detail.replace(/(E\d+)(?:–E?\d+)?$/, "$1") + "–" + r.detail.replace(/^S\d+E/, "");
        prior.ready = prior.ready && r.ready;
        return;
      }
      if (prior) return;
      byKey[key] = { day: day, title: r.title, detail: r.detail, ready: r.ready, kind: r.kind };
      rows.push(byKey[key]);
    });
    return rows.slice(0, limit || 6);
  }

  function dayLabel(day, today) {
    if (day === today) return "Today";
    if (day === today + 1) return "Tomorrow";
    var d = new Date(day * DAY);
    var name = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
    return day - today < 7 ? name : name + " " + d.getUTCDate() + "." + (d.getUTCMonth() + 1) + ".";
  }

  /* ---------- Wine of the day (grapy explorer) ---------- */

  function winePool(page, minConfidence) {
    var items = page && Array.isArray(page.items) ? page.items : [];
    return items.filter(function(w) {
      return w && w.rating && w.offers && w.offers.length && w.rating_evidence === "established" &&
        (w.match_confidence || 0) >= (minConfidence || 80);
    });
  }

  /* Deterministic per local day, and never the same wine two days running. */
  function wineOfTheDay(pool, day) {
    if (!pool.length) return null;
    var i = (day * 7) % pool.length;
    if (pool.length > 1 && i === ((day - 1) * 7) % pool.length) i = (i + 1) % pool.length;
    var w = pool[i], offers = w.offers.slice().sort(function(a, b) { return +a.price_per_750ml - +b.price_per_750ml; });
    return {
      id: w.wine_id, name: w.name, producer: w.producer, vintage: w.vintage, country: w.country, region: w.region,
      grapes: w.grapes || [], rating: Math.round(+w.rating), ratings: w.rating_count, style: w.style,
      price: +offers[0].price_per_750ml, shop: offers[0].source_name, productId: offers[0].product_id,
      hasImage: !!offers[0].has_image, otherShops: offers.length - 1,
      notes: (w.sensory || []).slice(0, 3).map(function(s) { return s.label.toLowerCase(); })
    };
  }

  /* ---------- Titles ---------- */

  /* An explicit `skyTitle` wins; otherwise "Sky over <label>", or just "Sky" without a label. */
  function skyTitle(title, location) {
    if (typeof title === "string" && title) return title;
    return location && location.label ? "Sky over " + location.label : "Sky";
  }

  function lakeTitle(lake) {
    if (lake && lake.title) return lake.title;
    var station = (lake && lake.station) || "mythenquai";
    return "Zürichsee · " + station.charAt(0).toUpperCase() + station.slice(1);
  }

  /* ---------- Formatting ---------- */

  function clock(ms) { var p = zurichParts(ms); return pad2(p.hh) + ":" + pad2(p.mm); }

  function duration(ms) {
    var minutes = Math.round(Math.abs(ms) / 60000);
    return Math.floor(minutes / 60) + "h " + pad2(minutes % 60) + "m";
  }

  function signedMinSec(ms) {
    var s = Math.round(Math.abs(ms) / 1000), sign = ms < 0 ? "−" : "+";
    return sign + Math.floor(s / 60) + "m " + pad2(s % 60) + "s";
  }

  function inQuietHours(ms, quiet) {
    if (!quiet) return false;
    var p = zurichParts(ms), now = p.hh * 60 + p.mm;
    function minutes(s) { var a = s.split(":"); return +a[0] * 60 + +a[1]; }
    var from = minutes(quiet.from), to = minutes(quiet.to);
    return from <= to ? now >= from && now < to : now >= from || now < to;
  }

  var api = {
    sunTimes: sunTimes, sunAltitude: sunAltitude, nextMoonPhase: nextMoonPhase, moonState: moonState,
    moonName: moonName, localDay: localDay, localMidnight: localMidnight, easter: easter, zurichHolidays: zurichHolidays, nextHoliday: nextHoliday,
    nextClockChange: nextClockChange, parseLake: parseLake, compass: compass, episodesFromSonarr: episodesFromSonarr,
    moviesFromRadarr: moviesFromRadarr, comingUp: comingUp, dayLabel: dayLabel, winePool: winePool,
    wineOfTheDay: wineOfTheDay, clock: clock, duration: duration, signedMinSec: signedMinSec,
    inQuietHours: inQuietHours, skyTitle: skyTitle, lakeTitle: lakeTitle, DAY: DAY
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Glance = api;
})(typeof window !== "undefined" ? window : this);
