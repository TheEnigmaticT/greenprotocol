import csv
import json
import shutil
from pathlib import Path

import pytest

from solvent_evidence_schema import (
    read_chem21_csv,
    read_density_csv,
    read_mixture_solubility_csv,
    read_single_solubility_csv,
    records_by_name,
    validate_manifest,
)


DATA_DIR = Path(__file__).parent / "data" / "solvent-evidence"
RAW_DIR = DATA_DIR / "raw"
MANIFEST_DIR = DATA_DIR / "manifests"


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def test_chem21_manifest_and_csv_have_53_valid_records(tmp_path):
    chem21_csv = RAW_DIR / "CHEM21_full.csv"
    manifest_path = MANIFEST_DIR / "chem21.json"

    manifest = validate_manifest(manifest_path, chem21_csv)
    records = list(read_chem21_csv(chem21_csv))

    assert manifest.record_count == 53
    assert len(records) == 53
    assert records_by_name(records)["n,n-dimethylformamide"].scores == (3, 9, 5)


def test_manifest_rejects_hash_and_required_column_mismatches(tmp_path):
    chem21_csv = RAW_DIR / "CHEM21_full.csv"
    manifest_path = MANIFEST_DIR / "chem21.json"
    tampered_csv = tmp_path / chem21_csv.name
    shutil.copyfile(chem21_csv, tampered_csv)
    with tampered_csv.open("a", encoding="utf-8") as handle:
        handle.write("\n")

    with pytest.raises(ValueError, match="SHA-256"):
        validate_manifest(manifest_path, tampered_csv)

    rows = list(csv.DictReader(chem21_csv.open(encoding="utf-8", newline="")))
    fieldnames = list(rows[0])
    fieldnames.remove("Ranking Default")
    csv_without_ranking = tmp_path / "without_ranking.csv"
    _write_csv(csv_without_ranking, fieldnames, rows)
    with pytest.raises(ValueError, match="Ranking Default"):
        list(read_chem21_csv(csv_without_ranking))


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("Ranking Default", "not-a-ranking", "Ranking Default"),
        ("Safety", "11", "Safety"),
    ],
)
def test_chem21_parser_rejects_invalid_ranking_and_scores(tmp_path, field, value, error):
    source = RAW_DIR / "CHEM21_full.csv"
    rows = list(csv.DictReader(source.open(encoding="utf-8", newline="")))
    rows[0][field] = value
    invalid_csv = tmp_path / "invalid.csv"
    _write_csv(invalid_csv, list(rows[0]), rows)

    with pytest.raises(ValueError, match=error):
        list(read_chem21_csv(invalid_csv))


def test_chem21_parser_rejects_duplicate_normalized_name_and_cas(tmp_path):
    source = RAW_DIR / "CHEM21_full.csv"
    rows = list(csv.DictReader(source.open(encoding="utf-8", newline="")))
    rows[1]["Solvent"] = rows[0]["Solvent"].upper().replace(" ", "_")
    duplicate_name = tmp_path / "duplicate_name.csv"
    _write_csv(duplicate_name, list(rows[0]), rows)
    with pytest.raises(ValueError, match="duplicate normalized CHEM21 name"):
        list(read_chem21_csv(duplicate_name))

    rows[1]["Solvent"] = "Unique solvent"
    rows[1]["CAS"] = rows[0]["CAS"]
    duplicate_cas = tmp_path / "duplicate_cas.csv"
    _write_csv(duplicate_cas, list(rows[0]), rows)
    with pytest.raises(ValueError, match="duplicate CHEM21 CAS"):
        list(read_chem21_csv(duplicate_cas))


def test_evidence_parsers_preserve_raw_measurements_units_and_dois():
    single = next(read_single_solubility_csv(RAW_DIR / "BigSolDBv2.0.csv"))
    mixture = next(read_mixture_solubility_csv(RAW_DIR / "MixtureSolDB.csv"))
    density = next(read_density_csv(RAW_DIR / "BigSolDBv2.0_densities.csv"))

    assert single.raw_measurements["Solubility(mol/L)"] == "0.010082794345776485"
    assert single.units["Solubility(mol/L)"] == "mol/L"
    assert single.source_doi == "10.1007/bf00649573"
    assert mixture.raw_measurements["Solubility(g/g100)"] == "212.33961473822944"
    assert mixture.units["Solubility(g/g100)"] == "g/g100"
    assert mixture.source_doi == "10.1007/s10973-018-7684-y"
    assert density.raw_measurements["Density_g/cm^3"] == "0.78975"
    assert density.units["Density_g/cm^3"] == "g/cm^3"
    assert density.source_doi == "10.1016/j.jct.2007.05.004"


def test_all_manifest_metadata_preserves_source_identity_and_schema_version():
    manifests = {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in MANIFEST_DIR.glob("*.json")
    }

    assert set(manifests) == {"chem21", "bigsoldb", "mixturesoldb", "densities"}
    assert manifests["chem21"]["source"]["acquisition_method"] == "manual_acquisition"
    assert manifests["chem21"]["source"]["doi"] == "10.1039/C5GC01008J"
    assert manifests["chem21"]["source"]["reuse_status"] == "unverified"
    assert manifests["bigsoldb"]["source"]["doi"] == "10.5281/zenodo.15094979"
    assert manifests["bigsoldb"]["source"]["paper_doi"] == "10.1038/s41597-025-05559-8"
    assert manifests["mixturesoldb"]["source"]["doi"] == "10.5281/zenodo.18660057"
    assert all(manifest["schema_version"] == 1 for manifest in manifests.values())
    assert all(manifest["license"] for manifest in manifests.values())


def test_evidence_parsers_iterate_complete_sources_and_preserve_missing_values():
    single_path = RAW_DIR / "BigSolDBv2.0.csv"
    mixture_path = RAW_DIR / "MixtureSolDB.csv"
    density_path = RAW_DIR / "BigSolDBv2.0_densities.csv"

    assert sum(1 for _ in read_single_solubility_csv(single_path)) == 103944
    assert sum(1 for _ in read_mixture_solubility_csv(mixture_path)) == 175626
    assert sum(1 for _ in read_density_csv(density_path)) == 2210

    single_with_missing_identifiers = next(
        record
        for record in read_single_solubility_csv(single_path)
        if record.compound_name == "Phloroglucinol tris(cyclic 2,2-dimethyl-1,3-propanediol phosphate)"
    )
    assert single_with_missing_identifiers.cas is None
    assert single_with_missing_identifiers.pubchem_id is None
    assert single_with_missing_identifiers.raw_values["CAS"] == ""
    assert single_with_missing_identifiers.raw_values["PubChem_CID"] == ""

    mixture_with_missing_measurements = next(
        record
        for record in read_mixture_solubility_csv(mixture_path)
        if record.compound_name == "Indomethacin"
    )
    assert mixture_with_missing_measurements.raw_measurements["Solubility(g/g100)"] is None
    assert mixture_with_missing_measurements.raw_values["Solubility(g/g100)"] == ""
    assert mixture_with_missing_measurements.units["Fraction_Solvent1"] == "mass"


def test_manifests_describe_measurement_conditions():
    manifests = {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in MANIFEST_DIR.glob("*.json")
    }

    assert manifests["chem21"]["measurement_conditions"]["score_scale"] == "1-10"
    assert manifests["bigsoldb"]["measurement_conditions"]["temperature_column"] == "Temperature_K"
    assert manifests["mixturesoldb"]["measurement_conditions"]["fraction_type_column"] == "Fraction_Type"
    assert manifests["densities"]["measurement_conditions"]["density_unit"] == "g/cm^3"
