#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = resolve(ROOT, "data/chemical-seeds/external");

const LISTS = [
  {
    id: "comptox_toxcast",
    url: "https://comptox.epa.gov/dashboard/chemical_lists/toxcast",
    output: "comptox_toxcast.csv",
  },
  {
    id: "comptox_tox21sl",
    url: "https://comptox.epa.gov/dashboard/chemical_lists/tox21sl",
    output: "comptox_tox21sl.csv",
  },
  {
    id: "comptox_cheminv",
    url: "https://comptox.epa.gov/dashboard/chemical-lists/CHEMINV",
    output: "comptox_cheminv.csv",
  },
  {
    id: "comptox_cpdat",
    url: "https://comptox.epa.gov/dashboard/chemical-lists/CPDAT",
    output: "comptox_cpdat.csv",
  },
];

const COLUMNS = [
  "preferredName",
  "casrn",
  "dtxsid",
  "dtxcid",
  "inchikey",
  "compoundId",
  "genericSubstanceId",
  "molFormula",
  "monoisotopicMass",
  "averageMass",
  "smiles",
  "qsarReadySmiles",
  "msReadySmiles",
  "qcLevel",
  "qcLevelDesc",
  "sourcesCount",
  "activeAssays",
  "totalAssays",
  "percentAssays",
  "source_list",
  "source_url",
];

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value).replace(/\r?\n/g, " ").trim();
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function chemicalsFromHtml(html, url) {
  const match = html.match(/<script>window\.__NUXT__=(.*?)<\/script>/s);
  if (!match) {
    throw new Error(`Could not find Nuxt data in ${url}`);
  }

  const context = { window: {} };
  vm.runInNewContext(`window.__NUXT__=${match[1]}`, context, {
    timeout: 5000,
    displayErrors: true,
  });

  const chemicals = context.window.__NUXT__?.data?.[0]?.chemicals;
  if (!Array.isArray(chemicals)) {
    throw new Error(`Could not find chemicals array in ${url}`);
  }
  return chemicals;
}

async function fetchList(list) {
  const response = await fetch(list.url, {
    headers: {
      "User-Agent": "GreenProtoCol/0.1 (greenchemistry.ai; contact: support@greenchemistry.ai)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`${list.url} returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const chemicals = chemicalsFromHtml(html, list.url);
  const rows = [
    COLUMNS.join(","),
    ...chemicals.map((chemical) =>
      COLUMNS.map((column) => {
        if (column === "source_list") return csvValue(list.id);
        if (column === "source_url") return csvValue(list.url);
        return csvValue(chemical[column]);
      }).join(","),
    ),
  ];

  const outputPath = resolve(OUT_DIR, list.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.join("\n")}\n`);
  return { id: list.id, output: outputPath, count: chemicals.length };
}

async function main() {
  const requested = new Set(process.argv.slice(2));
  const selected = requested.size
    ? LISTS.filter((list) => requested.has(list.id) || requested.has(list.output))
    : LISTS;

  if (selected.length === 0) {
    throw new Error(`No matching lists for: ${[...requested].join(", ")}`);
  }

  for (const list of selected) {
    const result = await fetchList(list);
    console.log(`${result.id}: wrote ${result.count} rows to ${result.output}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
