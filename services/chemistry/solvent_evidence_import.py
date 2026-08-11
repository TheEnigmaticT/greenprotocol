"""Build the local, queryable solvent evidence SQLite catalogue."""

from __future__ import annotations

import json
import os
import tempfile

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping
from rdkit import Chem

from solvent_evidence_schema import (
    Chem21Record,
    DatasetManifest,
    DensityRecord,
    MixtureSolubilityRecord,
    SingleSolubilityRecord,
    normalize_identity,
    read_chem21_csv,
    read_density_csv,
    read_mixture_solubility_csv,
    read_single_solubility_csv,
    validate_manifest,
)


@dataclass(frozen=True)
class ImportReport:
    """Immutable result of a successful evidence-index build."""

    index_path: Path
    record_counts: Mapping[str, int]


_DATASET_READERS = {
    "chem21": read_chem21_csv,
    "bigsoldb": read_single_solubility_csv,
    "mixturesoldb": read_mixture_solubility_csv,
    "bigsoldb_densities": read_density_csv,
}
_EXPECTED_DATASETS = frozenset(_DATASET_READERS)


def build_index(raw_dir: Path, manifests_dir: Path, output: Path) -> ImportReport:
    """Validate all source assets then atomically replace ``output`` with an index."""
    raw_dir = Path(raw_dir)
    manifests_dir = Path(manifests_dir)
    output = Path(output)
    manifests = _load_manifests(raw_dir, manifests_dir)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f"{output.name}.", suffix=".tmp", dir=output.parent
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        connection = sqlite3.connect(temporary)
        try:
            _create_schema(connection)
            counts = _insert_records(connection, raw_dir, manifests)
            _insert_metadata(connection, manifests)
            connection.commit()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            if integrity != ("ok",):
                raise ValueError(f"SQLite integrity check failed: {integrity!r}")
        finally:
            connection.close()
        temporary.replace(output)
    except Exception:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise

    return ImportReport(output, MappingProxyType(counts))


def _load_manifests(raw_dir: Path, manifests_dir: Path) -> dict[str, DatasetManifest]:
    manifests: dict[str, DatasetManifest] = {}
    for manifest_path in sorted(manifests_dir.glob("*.json")):
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        dataset_id = payload.get("dataset_id") if isinstance(payload, dict) else None
        if dataset_id not in _EXPECTED_DATASETS:
            raise ValueError(f"unsupported solvent-evidence dataset: {dataset_id!r}")
        if dataset_id in manifests:
            raise ValueError(f"duplicate manifest for dataset: {dataset_id}")
        asset_filename = payload.get("asset_filename") if isinstance(payload, dict) else None
        if not isinstance(asset_filename, str):
            raise ValueError(f"invalid manifest {manifest_path}: asset_filename is required")
        manifests[dataset_id] = validate_manifest(manifest_path, raw_dir / asset_filename)

    missing = sorted(_EXPECTED_DATASETS - manifests.keys())
    if missing:
        raise ValueError(f"missing solvent-evidence manifests: {', '.join(missing)}")
    return manifests


def _create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE schema_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE datasets (
            dataset_id TEXT PRIMARY KEY,
            manifest_json TEXT NOT NULL
        );
        CREATE TABLE chem21 (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            cas TEXT NOT NULL UNIQUE,
            pubchem_id INTEGER,
            safety INTEGER NOT NULL,
            health INTEGER NOT NULL,
            environment INTEGER NOT NULL,
            overall INTEGER NOT NULL,
            classification TEXT NOT NULL,
            replacements_json TEXT NOT NULL
        );
        CREATE TABLE chem21_aliases (
            normalized_alias TEXT PRIMARY KEY,
            chem21_id INTEGER NOT NULL REFERENCES chem21(id)
        );
        CREATE TABLE single_solubility (
            id INTEGER PRIMARY KEY,
            solute_smiles TEXT NOT NULL,
            normalized_solute_smiles TEXT NOT NULL,
            solvent TEXT NOT NULL,
            normalized_solvent TEXT NOT NULL,
            solvent_smiles TEXT NOT NULL,
            compound_name TEXT NOT NULL,
            cas TEXT,
            pubchem_id TEXT,
            temperature_k REAL,
            solubility_mole_fraction REAL,
            solubility_mol_per_l REAL,
            log_s_mol_per_l REAL,
            source_doi TEXT,
            measurements_json TEXT NOT NULL,
            units_json TEXT NOT NULL,
            raw_values_json TEXT NOT NULL
        );
        CREATE INDEX single_solubility_lookup
            ON single_solubility(normalized_solute_smiles, normalized_solvent, temperature_k);
        CREATE TABLE mixture_solubility (
            id INTEGER PRIMARY KEY,
            solute_smiles TEXT NOT NULL,
            solvent_1 TEXT NOT NULL,
            normalized_solvent_1 TEXT NOT NULL,
            solvent_2 TEXT NOT NULL,
            normalized_solvent_2 TEXT NOT NULL,
            solvent_1_smiles TEXT NOT NULL,
            solvent_2_smiles TEXT NOT NULL,
            compound_name TEXT NOT NULL,
            cas TEXT,
            pubchem_id TEXT,
            temperature_k REAL,
            solubility_mole_fraction REAL,
            log_s_mole_fraction REAL,
            solubility_g_per_g100 REAL,
            log_s_g_per_g100 REAL,
            fraction_solvent_1 REAL,
            fraction_type TEXT,
            source_doi TEXT,
            measurements_json TEXT NOT NULL,
            units_json TEXT NOT NULL,
            raw_values_json TEXT NOT NULL
        );
        CREATE INDEX mixture_solubility_lookup
            ON mixture_solubility(
                solute_smiles, normalized_solvent_1, normalized_solvent_2,
                fraction_solvent_1, fraction_type
            );
        CREATE TABLE density (
            id INTEGER PRIMARY KEY,
            solvent TEXT NOT NULL,
            normalized_solvent TEXT NOT NULL,
            temperature_k REAL,
            density_g_per_cm3 REAL,
            source_doi TEXT,
            measurements_json TEXT NOT NULL,
            units_json TEXT NOT NULL,
            raw_values_json TEXT NOT NULL
        );
        CREATE INDEX density_lookup ON density(normalized_solvent, temperature_k);
        CREATE TABLE hazard_profiles (
            id INTEGER PRIMARY KEY,
            normalized_name TEXT NOT NULL,
            profile_json TEXT NOT NULL
        );
        """
    )


def _insert_records(
    connection: sqlite3.Connection, raw_dir: Path, manifests: Mapping[str, DatasetManifest]
) -> dict[str, int]:
    counts = {
        "chem21": _insert_chem21(connection, read_chem21_csv(raw_dir / manifests["chem21"].asset_filename)),
        "single_solubility": _insert_single_solubility(
            connection, read_single_solubility_csv(raw_dir / manifests["bigsoldb"].asset_filename)
        ),
        "mixture_solubility": _insert_mixture_solubility(
            connection, read_mixture_solubility_csv(raw_dir / manifests["mixturesoldb"].asset_filename)
        ),
        "density": _insert_density(
            connection, read_density_csv(raw_dir / manifests["bigsoldb_densities"].asset_filename)
        ),
    }
    expected = {
        "chem21": manifests["chem21"].record_count,
        "single_solubility": manifests["bigsoldb"].record_count,
        "mixture_solubility": manifests["mixturesoldb"].record_count,
        "density": manifests["bigsoldb_densities"].record_count,
    }
    if counts != expected:
        raise ValueError(f"parsed record counts do not match manifests: {counts!r}")
    return counts


def _insert_chem21(connection: sqlite3.Connection, records: object) -> int:
    count = 0
    for record in records:  # type: ignore[union-attr]
        assert isinstance(record, Chem21Record)
        cursor = connection.execute(
            """INSERT INTO chem21 (
                name, normalized_name, cas, pubchem_id, safety, health, environment,
                overall, classification, replacements_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.name, normalize_identity(record.name), record.cas, record.pubchem_id,
                *record.scores, max(record.scores), record.classification,
                _json(record.replacements),
            ),
        )
        chem21_id = cursor.lastrowid
        for alias in (record.name, *record.aliases):
            normalized_alias = normalize_identity(alias)
            existing = connection.execute(
                "SELECT chem21_id FROM chem21_aliases WHERE normalized_alias = ?", (normalized_alias,)
            ).fetchone()
            if existing is not None and existing[0] != chem21_id:
                raise ValueError(f"duplicate normalized CHEM21 alias: {alias}")
            connection.execute(
                "INSERT OR IGNORE INTO chem21_aliases (normalized_alias, chem21_id) VALUES (?, ?)",
                (normalized_alias, chem21_id),
            )
        count += 1
    return count


def _insert_single_solubility(connection: sqlite3.Connection, records: object) -> int:
    count = 0
    for record in records:  # type: ignore[union-attr]
        assert isinstance(record, SingleSolubilityRecord)
        measurement = record.raw_measurements
        connection.execute(
            """INSERT INTO single_solubility (
                solute_smiles, normalized_solute_smiles, solvent, normalized_solvent, solvent_smiles, compound_name,
                cas, pubchem_id, temperature_k, solubility_mole_fraction,
                solubility_mol_per_l, log_s_mol_per_l, source_doi, measurements_json,
                units_json, raw_values_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.solute_smiles, _normalized_smiles(record.solute_smiles), record.solvent,
                normalize_identity(record.solvent), record.solvent_smiles, record.compound_name,
                record.cas, record.pubchem_id, _number(measurement["Temperature_K"]),
                _number(measurement["Solubility(mole_fraction)"]), _number(measurement["Solubility(mol/L)"]),
                _number(measurement["LogS(mol/L)"]), record.source_doi, _json(measurement), _json(record.units),
                _json(record.raw_values),
            ),
        )
        count += 1
    return count


def _insert_mixture_solubility(connection: sqlite3.Connection, records: object) -> int:
    count = 0
    for record in records:  # type: ignore[union-attr]
        assert isinstance(record, MixtureSolubilityRecord)
        measurement = record.raw_measurements
        connection.execute(
            """INSERT INTO mixture_solubility (
                solute_smiles, solvent_1, normalized_solvent_1, solvent_2, normalized_solvent_2,
                solvent_1_smiles, solvent_2_smiles, compound_name, cas, pubchem_id, temperature_k,
                solubility_mole_fraction, log_s_mole_fraction, solubility_g_per_g100,
                log_s_g_per_g100, fraction_solvent_1, fraction_type, source_doi,
                measurements_json, units_json, raw_values_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.solute_smiles, record.solvent_1, normalize_identity(record.solvent_1), record.solvent_2,
                normalize_identity(record.solvent_2), record.solvent_1_smiles, record.solvent_2_smiles,
                record.compound_name, record.cas, record.pubchem_id, _number(measurement["Temperature_K"]),
                _number(measurement["Solubility(mole_fraction)"]), _number(measurement["LogS(mole_fraction)"]),
                _number(measurement["Solubility(g/g100)"]), _number(measurement["LogS(g/g100)"]),
                _number(measurement["Fraction_Solvent1"]), normalize_identity(measurement["Fraction_Solvent1"] and record.units["Fraction_Solvent1"] or "") or None,
                record.source_doi, _json(measurement), _json(record.units), _json(record.raw_values),
            ),
        )
        count += 1
    return count


def _insert_density(connection: sqlite3.Connection, records: object) -> int:
    count = 0
    for record in records:  # type: ignore[union-attr]
        assert isinstance(record, DensityRecord)
        measurement = record.raw_measurements
        connection.execute(
            """INSERT INTO density (
                solvent, normalized_solvent, temperature_k, density_g_per_cm3, source_doi,
                measurements_json, units_json, raw_values_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.solvent, normalize_identity(record.solvent), _number(measurement["Temperature_K"]),
                _number(measurement["Density_g/cm^3"]), record.source_doi, _json(measurement),
                _json(record.units), _json(record.raw_values),
            ),
        )
        count += 1
    return count


def _insert_metadata(connection: sqlite3.Connection, manifests: Mapping[str, DatasetManifest]) -> None:
    connection.execute("INSERT INTO schema_metadata (key, value) VALUES (?, ?)", ("schema_version", "2"))
    for manifest in manifests.values():
        payload = {
            "schema_version": manifest.schema_version,
            "dataset_id": manifest.dataset_id,
            "asset_filename": manifest.asset_filename,
            "sha256": manifest.sha256,
            "record_count": manifest.record_count,
            "license": manifest.license,
            "attribution": manifest.attribution,
            "source": dict(manifest.source),
            "measurement_conditions": dict(manifest.measurement_conditions),
        }
        connection.execute(
            "INSERT INTO datasets (dataset_id, manifest_json) VALUES (?, ?)",
            (manifest.dataset_id, _json(payload)),
        )


def _normalized_smiles(smiles: str) -> str:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError(f"invalid solute SMILES in source asset: {smiles!r}")
    return Chem.MolToSmiles(molecule, canonical=True)


def _number(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _json(value: object) -> str:
    serializable = dict(value) if isinstance(value, Mapping) else value
    return json.dumps(serializable, sort_keys=True, separators=(",", ":"))
