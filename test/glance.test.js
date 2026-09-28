"use strict";
const test = require("node:test");
const assert = require("node:assert");
const G = require("../glance");

// Zurich city centre (public example location).
const ZURICH = [47.3769, 8.5417];
const MIN = 60000;

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ": " + new Date(actual).toISOString() + " vs " + new Date(expected).toISOString());
}

// References from PyEphem 4.2 (upper limb, horizon −0:34, pressure 0), i.e. the standard −0.833° event.
test("sunrise and sunset match an ephemeris within a minute", () => {
  const sep = G.sunTimes(Date.parse("2026-09-25T20:00:00Z"), ZURICH[0], ZURICH[1]);
  near(sep.rise, Date.parse("2026-09-25T05:16:27Z"), MIN, "Sep rise");
  near(sep.set, Date.parse("2026-09-25T17:17:44Z"), MIN, "Sep set");
  const jun = G.sunTimes(Date.parse("2026-06-21T02:00:00Z"), ZURICH[0], ZURICH[1]);
  near(jun.rise, Date.parse("2026-06-21T03:29:05Z"), MIN, "Jun rise");
  near(jun.set, Date.parse("2026-06-21T19:26:12Z"), MIN, "Jun set");
  const dec = G.sunTimes(Date.parse("2026-12-21T11:00:00Z"), ZURICH[0], ZURICH[1]);
  near(dec.rise, Date.parse("2026-12-21T07:10:09Z"), MIN, "Dec rise");
  near(dec.set, Date.parse("2026-12-21T15:37:37Z"), MIN, "Dec set");
});

test("sun times follow the Zurich calendar day, not the UTC one", () => {
  // 00:30 local on 26 Sep is still 25 Sep in UTC.
  const t = G.sunTimes(Date.parse("2026-09-25T22:30:00Z"), ZURICH[0], ZURICH[1]);
  assert.strictEqual(new Date(t.rise).toISOString().slice(0, 10), "2026-09-26");
});

test("daylight shrinks in autumn", () => {
  const a = G.sunTimes(Date.parse("2026-09-25T12:00:00Z"), ZURICH[0], ZURICH[1]);
  const b = G.sunTimes(Date.parse("2026-09-24T12:00:00Z"), ZURICH[0], ZURICH[1]);
  const delta = (a.set - a.rise) - (b.set - b.rise);
  assert.ok(delta < -2.5 * MIN && delta > -4 * MIN, "delta " + delta);
});

test("moon phases match an ephemeris within a few minutes", () => {
  const now = Date.parse("2026-09-25T22:00:00Z");
  near(G.nextMoonPhase(now, true), Date.parse("2026-09-26T16:48:58Z"), 5 * MIN, "full");
  near(G.nextMoonPhase(now, false), Date.parse("2026-10-10T15:50:01Z"), 5 * MIN, "new");
  near(G.nextMoonPhase(Date.parse("2027-01-01T00:00:00Z"), true), Date.parse("2027-01-22T12:17:18Z"), 5 * MIN, "full 2027");
  const state = G.moonState(now);
  assert.ok(state.illumination > 0.97 && state.waxing);
  assert.strictEqual(G.moonName(state), "Waxing gibbous");
  assert.strictEqual(G.moonName(G.moonState(Date.parse("2026-09-26T17:00:00Z"))), "Full moon");
});

test("Zurich holidays and Easter", () => {
  assert.strictEqual(new Date(G.easter(2026) * G.DAY).toISOString().slice(0, 10), "2026-04-05");
  assert.strictEqual(new Date(G.easter(2027) * G.DAY).toISOString().slice(0, 10), "2027-03-28");
  const next = G.nextHoliday(Date.parse("2026-09-25T20:00:00Z"));
  assert.deepStrictEqual([next.name, next.inDays], ["Christmas Day", 91]);
  assert.strictEqual(G.nextHoliday(Date.parse("2026-12-27T10:00:00Z")).name, "New Year's Day");
  const ascension = G.zurichHolidays(2027).filter((h) => h.name === "Ascension Day")[0];
  assert.strictEqual(new Date(ascension.day * G.DAY).toISOString().slice(0, 10), "2027-05-06");
});

test("next clock change", () => {
  const back = G.nextClockChange(Date.parse("2026-09-25T20:00:00Z"));
  assert.deepStrictEqual([new Date(back.at).toISOString(), back.forward], ["2026-10-25T01:00:00.000Z", false]);
  const fwd = G.nextClockChange(Date.parse("2026-11-01T00:00:00Z"));
  assert.deepStrictEqual([new Date(fwd.at).toISOString(), fwd.forward], ["2027-03-28T01:00:00.000Z", true]);
});

test("local midnight across the October switch", () => {
  const day = G.localDay(Date.parse("2026-10-25T12:00:00Z"));
  assert.strictEqual(new Date(G.localMidnight(day)).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.strictEqual(new Date(G.localMidnight(day + 1)).toISOString(), "2026-10-25T23:00:00.000Z");
});

function row(iso, water, extra) {
  const values = { water_temperature: { value: water, status: water === null ? "broken" : "ok" } };
  Object.keys(extra || {}).forEach((k) => { values[k] = { value: extra[k], status: "ok" }; });
  return { timestamp: iso, values: values };
}

test("lake parsing keeps the latest valid reading and a 24 h trend", () => {
  const lake = G.parseLake({ ok: true, result: [
    row("2026-09-24T20:00:00.000Z", 22.2),
    row("2026-09-25T20:00:00.000Z", 21.8, { air_temperature: 16.4, wind_direction: 153, wind_force_avg_10min: 1.2 }),
    row("2026-09-25T20:10:00.000Z", null)
  ] });
  assert.strictEqual(lake.latest.water, 21.8);
  assert.strictEqual(lake.latest.air, 16.4);
  assert.strictEqual(lake.change24h, -0.4);
  assert.strictEqual(lake.series.length, 2);
  assert.strictEqual(G.compass(lake.latest.dir), "SSE");
  assert.throws(() => G.parseLake({ ok: true, result: [] }));
});

test("coming up merges double episodes, skips the past and labels days", () => {
  const now = Date.parse("2026-09-25T20:00:00Z");
  const episodes = G.episodesFromSonarr([
    { airDateUtc: "2026-09-24T20:00:00Z", series: { title: "Old" }, seasonNumber: 1, episodeNumber: 1, monitored: true },
    { airDateUtc: "2026-09-28T00:00:00Z", series: { title: "Northern Lines" }, seasonNumber: 38, episodeNumber: 1, monitored: true },
    { airDateUtc: "2026-09-26T00:00:00Z", series: { title: "Tidewater" }, seasonNumber: 5, episodeNumber: 3, monitored: true },
    { airDateUtc: "2026-09-26T00:59:00Z", series: { title: "Tidewater" }, seasonNumber: 5, episodeNumber: 4, monitored: true, hasFile: true },
    { airDateUtc: "2026-09-27T00:00:00Z", series: { title: "Skipped" }, seasonNumber: 1, episodeNumber: 1, monitored: false }
  ]);
  const movies = G.moviesFromRadarr([
    { title: "Glass Orchard", digitalRelease: "2026-09-29T00:00:00Z", monitored: true },
    { title: "Too late", digitalRelease: "2026-12-01T00:00:00Z", monitored: true },
    { title: "Disc only", digitalRelease: "2026-01-01T00:00:00Z", physicalRelease: "2026-10-02T00:00:00Z", monitored: true }
  ], now, now + 21 * G.DAY);
  const rows = G.comingUp(episodes, movies, now, 10);
  assert.deepStrictEqual(rows.map((r) => r.title + " " + r.detail), [
    "Tidewater S05E03–04", "Northern Lines S38E01", "Glass Orchard Digital", "Disc only Blu-ray"
  ]);
  assert.strictEqual(rows[0].ready, false);
  const today = G.localDay(now);
  assert.deepStrictEqual(rows.map((r) => G.dayLabel(r.day, today)), ["Tomorrow", "Mon", "Tue", "Fri 2.10."]);
});

test("wine of the day is deterministic, filtered and changes daily", () => {
  function wine(id, confidence, evidence) {
    return { wine_id: id, name: "W" + id, rating: "85.00", rating_evidence: evidence || "established", match_confidence: confidence,
      offers: [{ price_per_750ml: "19.00", source_name: "B", product_id: id * 10 }, { price_per_750ml: "12.50", source_name: "A", product_id: id * 10 + 1 }],
      sensory: [{ label: "Raspberry" }, { label: "Violet" }, { label: "Potting Soil" }, { label: "Extra" }] };
  }
  const pool = G.winePool({ items: [wine(1, 95), wine(2, 60), wine(3, 90, "sparse"), wine(4, 81), wine(5, 99)] }, 80);
  assert.deepStrictEqual(pool.map((w) => w.wine_id), [1, 4, 5]);
  const today = G.wineOfTheDay(pool, 20000);
  assert.deepStrictEqual(G.wineOfTheDay(pool, 20000), today);
  assert.notStrictEqual(G.wineOfTheDay(pool, 20001).id, today.id);
  assert.deepStrictEqual([today.price, today.shop, today.otherShops, today.notes.length], [12.5, "A", 1, 3]);
  assert.strictEqual(G.wineOfTheDay([], 1), null);
});

test("quiet hours wrap midnight", () => {
  const q = { from: "23:00", to: "06:00" };
  assert.strictEqual(G.inQuietHours(Date.parse("2026-09-25T21:30:00Z"), q), true); // 23:30
  assert.strictEqual(G.inQuietHours(Date.parse("2026-09-26T03:59:00Z"), q), true); // 05:59
  assert.strictEqual(G.inQuietHours(Date.parse("2026-09-26T04:05:00Z"), q), false); // 06:05
  assert.strictEqual(G.inQuietHours(Date.parse("2026-09-26T10:00:00Z"), q), false);
});

test("formatting", () => {
  assert.strictEqual(G.duration(11 * 3600000 + 59 * MIN), "11h 59m");
  assert.strictEqual(G.signedMinSec(-(3 * MIN + 12000)), "−3m 12s");
  assert.strictEqual(G.clock(Date.parse("2026-09-25T05:16:27Z")), "07:16");
});

test("sky and lake titles", () => {
  assert.strictEqual(G.skyTitle(null, { latitude: 47.3769, longitude: 8.5417, label: "Zurich" }), "Sky over Zurich");
  assert.strictEqual(G.skyTitle(null, { latitude: 47.3769, longitude: 8.5417 }), "Sky");
  assert.strictEqual(G.skyTitle("Above the lake", { label: "Zurich" }), "Above the lake");
  assert.strictEqual(G.lakeTitle({ station: "mythenquai", title: "Zürichsee · Mythenquai" }), "Zürichsee · Mythenquai");
  assert.strictEqual(G.lakeTitle({ station: "tiefenbrunnen" }), "Zürichsee · Tiefenbrunnen");
});
