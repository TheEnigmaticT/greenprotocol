#!/usr/bin/env node
"use strict";
// Builds the upload bundle for the SciSure developer hub. No dependencies; needs the system `zip`.
//   node scripts/package.cjs [--src <dir>] [--out <dir>]
// Refuses to build unless the add-on, its schema and its default configuration agree.
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FILES = ["add-on.js", "configurationSchema.json", "defaultConfiguration.json", "config.example.json"];
const STAGING = "https://staging.greenchemistry.ai";
const EXPECTED_DEADLINE_MS = 3_900_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const src = path.resolve(arg("--src", path.join(__dirname, "..")));
const out = path.resolve(arg("--out", path.join(src, "dist")));

function fail(message) {
  console.error("package: " + message);
  process.exit(1);
}
function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(src, name), "utf8"));
  } catch (error) {
    return fail(name + " is not valid JSON: " + error.message);
  }
}
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

for (const name of FILES) if (!fs.existsSync(path.join(src, name))) fail("missing " + name);

// 1. The script must parse.
try {
  execFileSync(process.execPath, ["--check", path.join(src, "add-on.js")], { stdio: "pipe" });
} catch (error) {
  fail("add-on.js does not parse: " + String(error.stderr || error.message).split("\n")[0]);
}

// 2. One version everywhere.
const pkg = readJson("package.json");
const addOn = fs.readFileSync(path.join(src, "add-on.js"), "utf8");
// The exported object is `return { version: "x", init: ... }`.
const embedded = /return\s*\{\s*version:\s*"([^"]+)"\s*,\s*init:/.exec(addOn);
if (!embedded) fail("could not find the exported version in add-on.js");
if (embedded[1] !== pkg.version) fail("version mismatch: package.json " + pkg.version + " vs add-on.js " + embedded[1]);

// 3. Defaults are safe and agree with the runtime.
const defaults = readJson("defaultConfiguration.json");
const example = readJson("config.example.json");
const schema = readJson("configurationSchema.json");
if (JSON.stringify(defaults) !== JSON.stringify(example)) fail("config.example.json differs from defaultConfiguration.json");
if (defaults.gcaiBridge?.enabled !== false) fail("the bridge must ship disabled");
if (defaults.gcaiBaseUrl !== STAGING || defaults.gcaiBridge?.origin !== STAGING) fail("default origins must be " + STAGING);
if (defaults.gcaiBridge?.deadlineMs !== EXPECTED_DEADLINE_MS) fail("default deadlineMs must be " + EXPECTED_DEADLINE_MS);
const runtimeDeadline = /DEADLINE\s*=\s*(\d[\d_]*)/.exec(addOn);
if (!runtimeDeadline || Number(runtimeDeadline[1].replaceAll("_", "")) !== EXPECTED_DEADLINE_MS) fail("add-on.js DEADLINE does not match " + EXPECTED_DEADLINE_MS);
if (!schema.gcaiBaseUrl || !schema.gcaiBridge) fail("configurationSchema.json is missing gcaiBaseUrl or gcaiBridge");
if (/supplies|catalog|order/i.test(JSON.stringify(schema))) fail("configurationSchema.json still mentions supplies/catalog/order settings");

// 4. Build.
const name = "scisure-greenchemistry-addon-" + pkg.version;
const dir = path.join(out, name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const manifest = { name, version: pkg.version, builtAt: new Date().toISOString(), files: {} };
try {
  manifest.gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  manifest.gitDirty = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: src, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
} catch {
  manifest.gitCommit = null;
}
for (const file of FILES) {
  const bytes = fs.readFileSync(path.join(src, file));
  fs.writeFileSync(path.join(dir, file), bytes);
  manifest.files[file] = { bytes: bytes.length, sha256: sha256(bytes) };
}
fs.writeFileSync(path.join(dir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "SHA256SUMS"), FILES.map((file) => manifest.files[file].sha256 + "  " + file).join("\n") + "\n");

const zip = path.join(out, name + ".zip");
fs.rmSync(zip, { force: true });
const members = [...FILES, "MANIFEST.json", "SHA256SUMS"];
try {
  execFileSync("zip", ["-X", "-q", zip, ...members], { cwd: dir, stdio: "pipe" });
} catch (error) {
  fail("zip failed (is the zip command installed?): " + String(error.stderr || error.message).split("\n")[0]);
}
console.log("built " + zip);
console.log("upload this single file to the hub: " + path.join(dir, "add-on.js"));
console.log("add-on.js sha256 " + manifest.files["add-on.js"].sha256 + (manifest.gitDirty ? "  (working tree has uncommitted changes)" : ""));
