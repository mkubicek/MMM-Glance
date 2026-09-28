"use strict";
// The mirror runs Node 10 (helper) and Electron 16 / Chrome 96 (front end).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("runtime files avoid syntax Node 10 cannot parse", () => {
  ["glance.js", "MMM-Glance.js", "node_helper.js"].forEach((name) => {
    const code = read(name).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\?\.(?!\d)/, name + " uses optional chaining");
    assert.doesNotMatch(code, /\?\?/, name + " uses nullish coalescing");
  });
  assert.doesNotMatch(read("node_helper.js"), /\bfetch\(/, "Node 10 has no global fetch");
});

test("defaults: public Zurich location, wine and media cards inert until configured", () => {
  let definition;
  vm.runInNewContext(read("MMM-Glance.js"), { Module: { register: (name, d) => { definition = d; } } });
  const d = JSON.parse(JSON.stringify(definition.defaults)); // out of the vm realm
  assert.deepStrictEqual(d.location, { latitude: 47.3769, longitude: 8.5417, label: "Zurich" });
  assert.strictEqual(d.skyTitle, null);
  assert.deepStrictEqual([d.sonarr, d.radarr, d.grapy], [null, null, null]);
  const deck = Object.assign(Object.create(definition), { config: d, feed: {} });
  assert.deepStrictEqual(Array.from(deck.available()), ["sky"], "cards without data are skipped");
});
