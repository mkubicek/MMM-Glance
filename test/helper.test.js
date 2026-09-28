"use strict";
// Runs the real node_helper against a fake Sonarr on localhost, with secrets in a temporary HOME.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const Module = require("module");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "glance-home-"));
process.env.HOME = home;

// MagicMirror provides `node_helper`; a pass-through stub is enough here.
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request) {
  return request === "node_helper" ? "node_helper" : resolve.apply(this, arguments);
};
require.cache.node_helper = { id: "node_helper", filename: "node_helper", loaded: true, exports: { create: (o) => o } };

function helper() {
  const h = Object.create(require("../node_helper"));
  h.messages = [];
  h.sendSocketNotification = (name, payload) => h.messages.push([name, JSON.parse(JSON.stringify(payload))]);
  h.start();
  return h;
}

function until(check) {
  return new Promise((done, fail) => {
    const started = Date.now();
    (function poll() {
      if (check()) return done();
      if (Date.now() - started > 3000) return fail(new Error("timed out"));
      setTimeout(poll, 20);
    })();
  });
}

test("Sonarr credentials come from ~/.config/MMM-Glance/secrets.json; wine stays off without grapy", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers["x-api-key"] });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([{ airDateUtc: new Date(Date.now() + 864e5).toISOString(), series: { title: "Northern Lines" },
      seasonNumber: 2, episodeNumber: 7, monitored: true }]));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = path.join(home, ".config", "MMM-Glance");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "secrets.json"), JSON.stringify({
    sonarr: { url: "http://127.0.0.1:" + server.address().port, apiKey: "test-key" }
  }));

  const h = helper();
  try {
    h.socketNotificationReceived("GLANCE_START", { quietHours: null, lake: null, sonarr: null, radarr: null, grapy: null });
    await until(() => h.messages.some((m) => m[1].upcoming));
    const data = h.messages[h.messages.length - 1][1];
    assert.strictEqual(seen[0].key, "test-key");
    assert.match(seen[0].url, /^\/api\/v3\/calendar\?includeSeries=true&start=/);
    assert.deepStrictEqual(data.upcoming.episodes.map((e) => e.title + " " + e.detail), ["Northern Lines S02E07"]);
    assert.strictEqual(data.wine, null);
    assert.strictEqual(h.options.grapy, null);
    assert.strictEqual(seen.length, 1, "nothing but the Sonarr calendar was requested");
  } finally {
    clearInterval(h.timer);
    server.close();
  }
});
