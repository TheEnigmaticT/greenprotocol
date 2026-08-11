"""Typed readers and provenance validation for immutable solvent evidence assets."""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Iterable, Literal, Mapping


CHEM21_REQUIRED_COLUMNS = frozenset(
    {
        "PubChem ID",
        "CAS",
        "Solvent",
        "Solvent Alternative Name",
        "Safety",
        "Health",
        "Env",
        "Ranking Default",
        "Replacement 1",
        "Replacement 2",
    }
)
SINGLE_SOLUBILITY_REQUIRED_COLUMNS = frozenset(
    {
        "SMILES_Solute",
        "Temperature_K",
        "Solvent",
        "SMILES_Solvent",
        "Solubility(mole_fraction)",
        "Solubility(mol/L)",
        "LogS(mol/L)",
        "Compound_Name",
        "CAS",
        "PubChem_CID",
        "FDA_Approved",
        "Source",
    }
)
MIXTURE_SOLUBILITY_REQUIRED_COLUMNS = frozenset(
    {
        "SMILES_Solute",
        "Temperature_K",
        "Solubility(mole_fraction)",
        "LogS(mole_fraction)",
        "Solubility(g/g100)",
        "LogS(g/g100)",
        "Solvent1",
        "Solvent2",
        "SMILES_Solvent1",
        "SMILES_Solvent2",
        "Fraction_Solvent1",
        "Fraction_Type",
        "Compound_Name",
        "CAS",
        "PubChem_CID",
        "FDA_Approved",
        "Source",
    }
)
DENSITY_REQUIRED_COLUMNS = frozenset(
    {"Solvent", "Temperature_K", "Density_g/cm^3", "Source"}
)


@dataclass(frozen=True)
class DatasetManifest:
    schema_version: int
    dataset_id: str
    asset_filename: str
    sha256: str
    record_count: int
    license: str
    attribution: str
    source: Mapping[str, str]


@dataclass(frozen=True)
class Chem21Record:
    name: str
    aliases: tuple[str, ...]
    cas: str
    pubchem_id: int | None
    scores: tuple[int, int, int]
    classification: Literal[
        "recommended", "problematic", "hazardous", "highly_hazardous"
    ]
    replacements: tuple[str, ...]


@dataclass(frozen=True)
class SingleSolubilityRecord:
    solute_smiles: str
    solvent: str
    solvent_smiles: str
    compound_name: str
    cas: str
    pubchem_id: str
    raw_measurements: Mapping[str, str]
    units: Mapping[str, str]
    source_doi: str
    raw_values: Mapping[str, str]


@dataclass(frozen=True)
class MixtureSolubilityRecord:
    solute_smiles: str
    solvent_1: str
    solvent_2: str
    solvent_1_smiles: str
    solvent_2_smiles: str
    compound_name: str
    cas: str
    pubchem_id: str
    raw_measurements: Mapping[str, str]
    units: Mapping[str, str]
    source_doi: str
    raw_values: Mapping[str, str]


@dataclass(frozen=True)
class DensityRecord:
    solvent: str
    raw_measurements: Mapping[str, str]
    units: Mapping[str, str]
    source_doi: str
    raw_values: Mapping[str, str]


def normalize_identity(value: str) -> str:
    return " ".join(value.casefold().replace("_", " ").split())


def validate_manifest(path: str | Path, asset_path: str | Path) -> DatasetManifest:
    """Validate a manifest's shape and bind it to the exact asset bytes."""
    manifest_path = Path(path)
    asset = Path(asset_path)
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid manifest {manifest_path}: {exc}") from exc

    required = {
        "schema_version",
        "dataset_id",
        "asset_filename",
        "sha256",
        "record_count",
        "license",
        "attribution",
        "source",
    }
    missing = sorted(required - payload.keys()) if isinstance(payload, dict) else sorted(required)
    if missing:
        raise ValueError(f"manifest missing required fields: {', '.join(missing)}")
    if payload["schema_version"] != 1:
        raise ValueError("manifest schema_version must be 1")
    if not isinstance(payload["record_count"], int) or payload["record_count"] < 0:
        raise ValueError("manifest record_count must be a non-negative integer")
    if payload["asset_filename"] != asset.name:
        raise ValueError("manifest asset_filename does not match asset path")
    if not all(isinstance(payload[field], str) and payload[field] for field in ("dataset_id", "sha256", "license", "attribution")):
        raise ValueError("manifest identity fields must be non-empty strings")
    source = payload["source"]
    if not isinstance(source, dict) or not all(
        isinstance(source.get(field), str) and source[field]
        for field in ("name", "doi", "acquisition_method", "reuse_status")
    ):
        raise ValueError("manifest source metadata is incomplete")

    actual_sha256 = _sha256(asset)
    if payload["sha256"] != actual_sha256:
        raise ValueError("manifest SHA-256 does not match asset")
    if _csv_record_count(asset) != payload["record_count"]:
        raise ValueError("manifest record_count does not match asset")

    return DatasetManifest(
        schema_version=payload["schema_version"],
        dataset_id=payload["dataset_id"],
        asset_filename=payload["asset_filename"],
        sha256=payload["sha256"],
        record_count=payload["record_count"],
        license=payload["license"],
        attribution=payload["attribution"],
        source=MappingProxyType(source.copy()),
    )


def read_chem21_csv(path: str | Path) -> Iterable[Chem21Record]:
    seen_names: set[str] = set()
    seen_cas: set[str] = set()
    for row_number, row in _dict_rows(path, CHEM21_REQUIRED_COLUMNS):
        name = _required_cell(row, "Solvent", row_number)
        normalized_name = normalize_identity(name)
        if normalized_name in seen_names:
            raise ValueError(f"duplicate normalized CHEM21 name at row {row_number}: {name}")
        seen_names.add(normalized_name)

        cas = _required_cell(row, "CAS", row_number)
        normalized_cas = normalize_identity(cas)
        if normalized_cas in seen_cas:
            raise ValueError(f"duplicate CHEM21 CAS at row {row_number}: {cas}")
        seen_cas.add(normalized_cas)

        scores = tuple(
            _score(row, field, row_number) for field in ("Safety", "Health", "Env")
        )
        classification = _classification(row, row_number)
        aliases = _nonempty_cells(row, "Solvent Alternative Name")
        replacements = _nonempty_cells(row, "Replacement 1", "Replacement 2")
        yield Chem21Record(
            name=name,
            aliases=aliases,
            cas=cas,
            pubchem_id=_optional_int(row.get("PubChem ID"), "PubChem ID", row_number),
            scores=scores,
            classification=classification,
            replacements=replacements,
        )


def read_single_solubility_csv(path: str | Path) -> Iterable[SingleSolubilityRecord]:
    measurement_fields = (
        "Temperature_K",
        "Solubility(mole_fraction)",
        "Solubility(mol/L)",
        "LogS(mol/L)",
    )
    units = MappingProxyType(
        {
            "Temperature_K": "K",
            "Solubility(mole_fraction)": "mole_fraction",
            "Solubility(mol/L)": "mol/L",
            "LogS(mol/L)": "mol/L",
        }
    )
    for row_number, row in _dict_rows(path, SINGLE_SOLUBILITY_REQUIRED_COLUMNS):
        yield SingleSolubilityRecord(
            solute_smiles=_required_cell(row, "SMILES_Solute", row_number),
            solvent=_required_cell(row, "Solvent", row_number),
            solvent_smiles=_required_cell(row, "SMILES_Solvent", row_number),
            compound_name=_required_cell(row, "Compound_Name", row_number),
            cas=_required_cell(row, "CAS", row_number),
            pubchem_id=_required_cell(row, "PubChem_CID", row_number),
            raw_measurements=_measurements(row, measurement_fields, row_number),
            units=units,
            source_doi=_required_cell(row, "Source", row_number),
            raw_values=_immutable_row(row),
        )


def read_mixture_solubility_csv(path: str | Path) -> Iterable[MixtureSolubilityRecord]:
    measurement_fields = (
        "Temperature_K",
        "Solubility(mole_fraction)",
        "LogS(mole_fraction)",
        "Solubility(g/g100)",
        "LogS(g/g100)",
        "Fraction_Solvent1",
    )
    units = MappingProxyType(
        {
            "Temperature_K": "K",
            "Solubility(mole_fraction)": "mole_fraction",
            "LogS(mole_fraction)": "mole_fraction",
            "Solubility(g/g100)": "g/g100",
            "LogS(g/g100)": "g/g100",
            "Fraction_Solvent1": "raw_fraction",
        }
    )
    for row_number, row in _dict_rows(path, MIXTURE_SOLUBILITY_REQUIRED_COLUMNS):
        yield MixtureSolubilityRecord(
            solute_smiles=_required_cell(row, "SMILES_Solute", row_number),
            solvent_1=_required_cell(row, "Solvent1", row_number),
            solvent_2=_required_cell(row, "Solvent2", row_number),
            solvent_1_smiles=_required_cell(row, "SMILES_Solvent1", row_number),
            solvent_2_smiles=_required_cell(row, "SMILES_Solvent2", row_number),
            compound_name=_required_cell(row, "Compound_Name", row_number),
            cas=_required_cell(row, "CAS", row_number),
            pubchem_id=_required_cell(row, "PubChem_CID", row_number),
            raw_measurements=_measurements(row, measurement_fields, row_number),
            units=units,
            source_doi=_required_cell(row, "Source", row_number),
            raw_values=_immutable_row(row),
        )


def read_density_csv(path: str | Path) -> Iterable[DensityRecord]:
    measurement_fields = ("Temperature_K", "Density_g/cm^3")
    units = MappingProxyType({"Temperature_K": "K", "Density_g/cm^3": "g/cm^3"})
    for row_number, row in _dict_rows(path, DENSITY_REQUIRED_COLUMNS):
        yield DensityRecord(
            solvent=_required_cell(row, "Solvent", row_number),
            raw_measurements=_measurements(row, measurement_fields, row_number),
            units=units,
            source_doi=_required_cell(row, "Source", row_number),
            raw_values=_immutable_row(row),
        )


def records_by_name(records: Iterable[Chem21Record]) -> dict[str, Chem21Record]:
    return {normalize_identity(record.name): record for record in records}


def _dict_rows(path: str | Path, required_columns: frozenset[str]) -> Iterable[tuple[int, dict[str, str]]]:
    csv_path = Path(path)
    with csv_path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        actual_columns = set(reader.fieldnames or ())
        missing_columns = sorted(required_columns - actual_columns)
        if missing_columns:
            raise ValueError(f"{csv_path.name} missing required columns: {', '.join(missing_columns)}")
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                raise ValueError(f"{csv_path.name} has extra values at row {row_number}")
            yield row_number, row


def _score(row: Mapping[str, str], field: str, row_number: int) -> int:
    value = _required_cell(row, field, row_number)
    try:
        score = int(value)
    except ValueError as exc:
        raise ValueError(f"invalid {field} score at row {row_number}: {value!r}") from exc
    if not 1 <= score <= 10:
        raise ValueError(f"invalid {field} score at row {row_number}: {value!r}; expected 1-10")
    return score


def _classification(
    row: Mapping[str, str], row_number: int
) -> Literal["recommended", "problematic", "hazardous", "highly_hazardous"]:
    raw_value = _required_cell(row, "Ranking Default", row_number)
    classification = "_".join(raw_value.casefold().replace("-", " ").split())
    allowed = {"recommended", "problematic", "hazardous", "highly_hazardous"}
    if classification not in allowed:
        raise ValueError(f"invalid Ranking Default at row {row_number}: {raw_value!r}")
    return classification  # type: ignore[return-value]


def _optional_int(value: str | None, field: str, row_number: int) -> int | None:
    if value is None or not value.strip():
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _required_cell(row: Mapping[str, str], field: str, row_number: int) -> str:
    value = row.get(field)
    if value is None or not value.strip():
        raise ValueError(f"missing {field} value at row {row_number}")
    return value


def _nonempty_cells(row: Mapping[str, str], *fields: str) -> tuple[str, ...]:
    return tuple(row[field] for field in fields if row.get(field, "").strip())


def _measurements(
    row: Mapping[str, str], fields: tuple[str, ...], row_number: int
) -> Mapping[str, str]:
    return MappingProxyType({field: _required_cell(row, field, row_number) for field in fields})


def _immutable_row(row: Mapping[str, str]) -> Mapping[str, str]:
    return MappingProxyType(dict(row))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _csv_record_count(path: Path) -> int:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        return sum(1 for _ in reader)
