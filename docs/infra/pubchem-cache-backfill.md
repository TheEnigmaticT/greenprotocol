# PubChem Cache Backfill

This flow keeps GreenChemistry.ai from depending on live PubChem lookups for every protocol. It builds a durable queue from curated lab chemicals plus EPA CompTox exports, then hydrates one chemical at a time into `services/chemistry/pubchem_cache_seed.json` or the live chemistry service cache.

## Sources

The manifest lives at `data/chemical-seeds/source-manifest.json`. The starting external sources are:

- EPA CompTox TOXCAST chemical list: `https://comptox.epa.gov/dashboard/chemical_lists/toxcast`
- EPA CompTox TOX21SL chemical list: `https://comptox.epa.gov/dashboard/chemical_lists/tox21sl`
- EPA CompTox CHEMINV chemical inventory: `https://comptox.epa.gov/dashboard/chemical-lists/CHEMINV`
- EPA CompTox CPDat chemical list: `https://comptox.epa.gov/dashboard/chemical-lists/CPDAT`

Fetch the CSVs from the server-rendered Dashboard pages:

```bash
node scripts/fetch-comptox-chemical-lists.mjs
```

CPDat is larger than the Dashboard payload path can safely evaluate locally, so fetch its public Figshare package and extract a unique chemical list:

```bash
curl -L -o data/chemical-seeds/external/cpdat_v4.0.zip \
  https://ndownloader.figshare.com/files/53538266

python3 scripts/extract-cpdat-chemical-list.py
```

Those raw exports are written to `data/chemical-seeds/external/` and intentionally gitignored.

## Build The Queue

```bash
python3 scripts/build-chemical-seed-list.py
```

For a smaller first pass:

```bash
python3 scripts/build-chemical-seed-list.py --limit 5000
```

The generated queue is `data/chemical-seeds/chemical-seed-list.generated.json`. It is also gitignored because it can become large and is reproducible from the manifest plus source CSVs.

## Run The Slow Worker

Process one chemical per minute into an ignored generated cache file:

```bash
python3 scripts/run-pubchem-cache-worker.py --delay 60
```

Process one chemical and exit, useful for cron or launchd:

```bash
python3 scripts/run-pubchem-cache-worker.py --once
```

Sync each hydrated entry into a deployed chemistry service:

```bash
python3 scripts/run-pubchem-cache-worker.py \
  --delay 60 \
  --sync-url "$CHEMISTRY_SERVICE_URL" \
  --token "$CHEMISTRY_SERVICE_TOKEN"
```

The worker stores progress in `data/chemical-seeds/pubchem-cache-worker-state.json`, so it can be stopped and restarted without beginning again.

## Back Up Local Progress

Create a timestamped JSON-validated backup of the generated cache and worker state:

```bash
python3 scripts/backup-pubchem-cache.py
```

For an hourly local backup loop:

```bash
while true; do
  python3 scripts/backup-pubchem-cache.py
  sleep 3600
done
```

Backups are written to `data/chemical-seeds/backups/`, which is intentionally gitignored. By default, the script keeps the latest 72 backups per file.

To deliberately refresh the bundled cache committed with the chemistry service, pass:

```bash
python3 scripts/run-pubchem-cache-worker.py \
  --delay 60 \
  --output services/chemistry/pubchem_cache_seed.json
```
