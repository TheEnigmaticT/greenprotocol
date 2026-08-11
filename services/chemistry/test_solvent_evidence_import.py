import csv
import hashlib
import json
from pathlib import Path

import pytest

from solvent_evidence_import import build_index
from solvent_evidence_store import SolventEvidenceStore


CHEM21_COLUMNS = (
    "PubChem ID", "CAS", "Solvent", "Solvent Alternative Name", "Safety", "Health",
    "Env", "Ranking Default", "Replacement 1", "Replacement 2",
)
SINGLE_COLUMNS = (
    "SMILES_Solute", "Temperature_K", "Solvent", "SMILES_Solvent",
    "Solubility(mole_fraction)", "Solubility(mol/L)", "LogS(mol/L)",
    "Compound_Name", "CAS", "PubChem_CID", "FDA_Approved", "Source",
)
MIXTURE_COLUMNS = (
    "SMILES_Solute", "Temperature_K", "Solubility(mole_fraction)",
    "LogS(mole_fraction)", "Solubility(g/g100)", "LogS(g/g100)", "Solvent1",
    "Solvent2", "SMILES_Solvent1", "SMILES_Solvent2", "Fraction_Solvent1",
    "Fraction_Type", "Compound_Name", "CAS", "PubChem_CID", "FDA_Approved", "Source",
)
DENSITY_COLUMNS = ("Solvent", "Temperature_K", "Density_g/cm^3", "Source")


def _write_dataset(raw_dir: Path, manifests_dir: Path, dataset_id: str, filename: str,
                   columns: tuple[str, ...], row: dict[str, str]) -> None:
    raw_path = raw_dir / filename
    with raw_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerow(row)

    manifest = {
        "schema_version": 1,
        "dataset_id": dataset_id,
        "asset_filename": filename,
        "sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
        "record_count": 1,
        "license": "test-license",
        "attribution": "test attribution",
        "source": {
            "name": "test source",
            "doi": "10.1000/test",
            "acquisition_method": "fixture",
            "reuse_status": "test",
        },
        "measurement_conditions": {"temperature_unit": "K"},
    }
    (manifests_dir / f"{dataset_id}.json").write_text(json.dumps(manifest), encoding="utf-8")


@pytest.fixture
def fixture_assets(tmp_path):
    raw_dir = tmp_path / "raw"
    manifests_dir = tmp_path / "manifests"
    raw_dir.mkdir()
    manifests_dir.mkdir()

    _write_dataset(
        raw_dir, manifests_dir, "chem21", "chem21.csv", CHEM21_COLUMNS,
        {
            "PubChem ID": "6228", "CAS": "68-12-2", "Solvent": "N,N-Dimethylformamide",
            "Solvent Alternative Name": "DMF", "Safety": "3", "Health": "9", "Env": "5",
            "Ranking Default": "Hazardous", "Replacement 1": "Acetonitrile", "Replacement 2": "",
        },
    )
    _write_dataset(
        raw_dir, manifests_dir, "bigsoldb", "single.csv", SINGLE_COLUMNS,
        {
            "SMILES_Solute": "CCO", "Temperature_K": "298.15", "Solvent": "ethanol",
            "SMILES_Solvent": "CCO", "Solubility(mole_fraction)": "0.1",
            "Solubility(mol/L)": "1.0", "LogS(mol/L)": "0.0", "Compound_Name": "ethanol",
            "CAS": "64-17-5", "PubChem_CID": "702", "FDA_Approved": "true",
            "Source": "10.1007/example",
        },
    )
    _write_dataset(
        raw_dir, manifests_dir, "mixturesoldb", "mixture.csv", MIXTURE_COLUMNS,
        {
            "SMILES_Solute": "CCO", "Temperature_K": "298.15",
            "Solubility(mole_fraction)": "0.1", "LogS(mole_fraction)": "-1.0",
            "Solubility(g/g100)": "10.0", "LogS(g/g100)": "1.0", "Solvent1": "ethanol",
            "Solvent2": "water", "SMILES_Solvent1": "CCO", "SMILES_Solvent2": "O",
            "Fraction_Solvent1": "0.5", "Fraction_Type": "mole", "Compound_Name": "ethanol",
            "CAS": "64-17-5", "PubChem_CID": "702", "FDA_Approved": "true",
            "Source": "10.1007/example",
        },
    )
    _write_dataset(
        raw_dir, manifests_dir, "bigsoldb_densities", "density.csv", DENSITY_COLUMNS,
        {"Solvent": "ethanol", "Temperature_K": "298.15", "Density_g/cm^3": "0.789", "Source": "10.1007/example"},
    )
    return raw_dir, manifests_dir


def test_build_index_is_transactional_and_queries_all_measurement_kinds(tmp_path, fixture_assets):
    fixture_raw, fixture_manifests = fixture_assets
    report = build_index(fixture_raw, fixture_manifests, tmp_path / "evidence.sqlite")
    store = SolventEvidenceStore(report.index_path)

    assert report.record_counts == {
        "chem21": 1, "single_solubility": 1, "mixture_solubility": 1, "density": 1,
    }
    assert store.lookup_chem21("DMF")["scores"] == {
        "safety": 3, "health": 9, "environment": 5, "overall": 9,
    }
    assert store.single_solubility("CCO", "ethanol", 298.15)[0]["source"] == "10.1007/example"
    assert store.mixture_solubility("CCO", "ethanol", "water", 0.5, "mole")
    assert store.density("ethanol", 298.15)[0]["density_g_per_cm3"] > 0


def test_failed_rebuild_leaves_prior_valid_index_untouched(tmp_path, fixture_assets):
    raw_dir, manifests_dir = fixture_assets
    index = tmp_path / "evidence.sqlite"
    build_index(raw_dir, manifests_dir, index)
    (raw_dir / "chem21.csv").write_text("invalid", encoding="utf-8")

    with pytest.raises(ValueError):
        build_index(raw_dir, manifests_dir, index)

    assert SolventEvidenceStore(index).lookup_chem21("DMF") is not None


def test_p5_reports_chem21_unavailable_without_reclassifying_solvents(monkeypatch):
    from scoring.models import ChemicalInput
    import scoring.p5_safer_solvents as p5
    from solvent_evidence_store import SolventEvidenceUnavailableError

    def unavailable(_: str):
        raise SolventEvidenceUnavailableError("CHEM21 index is unavailable")

    monkeypatch.setattr(p5, "lookup_solvent", unavailable)
    result = p5.score_p5([ChemicalInput(name="unlisted solvent", role="solvent")])

    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == "unavailable"
    assert result.details["error"] == "CHEM21 data unavailable: CHEM21 index is unavailable"
