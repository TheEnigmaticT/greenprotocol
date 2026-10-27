"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const script = path.join(root, "scripts", "package.cjs");
const FILES = ["add-on.js", "configurationSchema.json", "defaultConfiguration.json", "config.example.json", "package.json"];

function stage(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "addon-pkg-"));
  for (const file of FILES) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  if (mutate) mutate(dir);
  return dir;
}
const run = (src, out) => spawnSync(process.execPath, [script, "--src", src, "--out", out], { encoding: "utf8" });

test("builds a zip whose members match the manifest and checksums", () => {
  const src = stage();
  const out = path.join(src, "out");
  const result = run(src, out);
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
  const name = "scisure-greenchemistry-addon-" + pkg.version;
  const members = execFileSync("unzip", ["-Z1", path.join(out, name + ".zip")], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(members, ["MANIFEST.json", "SHA256SUMS", "add-on.js", "config.example.json", "configurationSchema.json", "defaultConfiguration.json"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, name, "MANIFEST.json"), "utf8"));
  const bytes = fs.readFileSync(path.join(out, name, "add-on.js"));
  assert.equal(manifest.files["add-on.js"].sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(bytes, fs.readFileSync(path.join(root, "add-on.js")));
});

test("refuses a version mismatch between package.json and add-on.js", () => {
  const src = stage((dir) => {
    const file = path.join(dir, "package.json");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
  });
  const result = run(src, path.join(src, "out"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version mismatch/);
  assert.equal(fs.existsSync(path.join(src, "out")), false);
});

test("refuses defaults that enable the bridge, point at another origin, or shorten the timeout", () => {
  for (const [patch, expected] of [
    [{ gcaiBridge: { enabled: true, origin: "https://staging.greenchemistry.ai", path: "/integrations/scisure/connect", deadlineMs: 3900000 } }, /ship disabled/],
    [{ gcaiBridge: { enabled: false, origin: "https://greenchemistry.ai", path: "/integrations/scisure/connect", deadlineMs: 3900000 } }, /default origins/],
    [{ gcaiBridge: { enabled: false, origin: "https://staging.greenchemistry.ai", path: "/integrations/scisure/connect", deadlineMs: 60000 } }, /deadlineMs/],
  ]) {
    const src = stage((dir) => {
      const config = { gcaiBaseUrl: "https://staging.greenchemistry.ai", ...patch };
      fs.writeFileSync(path.join(dir, "defaultConfiguration.json"), JSON.stringify(config));
      fs.writeFileSync(path.join(dir, "config.example.json"), JSON.stringify(config));
    });
    const result = run(src, path.join(src, "out"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});

test("refuses a script that does not parse and an example that drifted from the defaults", () => {
  const broken = stage((dir) => fs.appendFileSync(path.join(dir, "add-on.js"), "\n}}}\n"));
  assert.match(run(broken, path.join(broken, "out")).stderr, /does not parse/);
  const drift = stage((dir) => fs.writeFileSync(path.join(dir, "config.example.json"), "{}"));
  assert.match(run(drift, path.join(drift, "out")).stderr, /differs from defaultConfiguration/);
});
