"""Read-only queries for the generated local solvent evidence index."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solvent_evidence_schema import normalize_identity


class SolventEvidenceUnavailableError(RuntimeError):
    """The generated local index is absent, invalid, or unreadable."""



@dataclass(frozen=True)
class HazardProfile:
    """A locally persisted, source-backed PubChem GHS profile."""

    solvent: str
    cid: int
    hcodes: tuple[dict[str, str], ...]
    cmr: bool
    acute: bool
    organ: bool
    health: bool
    environmental: bool
    physical: bool
    source_url: str
    snapshot_path: str
    snapshot_sha256: str
    retrieved_at: str
    state: str

    def category_levels(self) -> dict[str, int]:
        """Return the screening-facing binary levels for sourced GHS categories."""
        return {
            "cmr": int(self.cmr),
            "acute": int(self.acute),
            "organ": int(self.organ),
            "environment": int(self.environmental),
            "physical": int(self.physical),
        }

class SolventEvidenceStore:
    """Validated read-only access to a generated solvent evidence SQLite index."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self._validate()

    def lookup_chem21(self, name: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT c.name, c.classification, c.safety, c.health, c.environment,
                          c.overall, c.replacements_json
                   FROM chem21_aliases AS a
                   JOIN chem21 AS c ON c.id = a.chem21_id
                   WHERE a.normalized_alias = ?""",
                (normalize_identity(name),),
            ).fetchone()
        if row is None:
            return None
        result = {
            "name": row["name"],
            "classification": row["classification"],
            "scores": {
                "safety": row["safety"],
                "health": row["health"],
                "environment": row["environment"],
                "overall": row["overall"],
            },
        }
        replacements = json.loads(row["replacements_json"])
        if replacements:
            result["replacements"] = replacements
        return result

    def hazard_profile(self, solvent: str) -> HazardProfile | None:
        """Return a complete local PubChem GHS profile for a catalogued solvent."""
        normalized = normalize_identity(solvent)
        with self._connect() as connection:
            row = connection.execute(
                """SELECT h.profile_json
                   FROM hazard_profiles AS h
                   WHERE h.normalized_name = COALESCE(
                       (SELECT c.normalized_name
                        FROM chem21_aliases AS a
                        JOIN chem21 AS c ON c.id = a.chem21_id
                        WHERE a.normalized_alias = ?),
                       ?
                   )
                   LIMIT 1""",
                (normalized, normalized),
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(row["profile_json"])
        if payload.get("state") != "complete":
            return None
        snapshot = payload["snapshot"]
        return HazardProfile(
            solvent=payload["solvent"],
            cid=payload["cid"],
            hcodes=tuple(payload["hcodes"]),
            cmr=payload["cmr"],
            acute=payload["acute"],
            organ=payload["organ"],
            health=payload["health"],
            environmental=payload["environmental"],
            physical=payload["physical"],
            source_url=payload["source_url"],
            snapshot_path=snapshot["path"],
            snapshot_sha256=snapshot["sha256"],
            retrieved_at=snapshot["retrieved_at"],
            state=payload["state"],
        )

    def single_solubility(self, solute_smiles: str, solvent: str, temperature_k: float) -> list[dict[str, Any]]:
        return self._query_measurements(
            """SELECT solute_smiles, solvent, solvent_smiles, compound_name, cas, pubchem_id,
                      temperature_k, solubility_mole_fraction, solubility_mol_per_l,
                      log_s_mol_per_l, source_doi, measurements_json, units_json, raw_values_json
               FROM single_solubility
               WHERE solute_smiles = ? AND normalized_solvent = ? AND temperature_k IS ?""",
            (solute_smiles, normalize_identity(solvent), temperature_k),
            self._single_result,
        )

    def mixture_solubility(
        self, solute_smiles: str, solvent_1: str, solvent_2: str,
        fraction_solvent_1: float, fraction_type: str,
    ) -> list[dict[str, Any]]:
        return self._query_measurements(
            """SELECT solute_smiles, solvent_1, solvent_2, solvent_1_smiles, solvent_2_smiles,
                      compound_name, cas, pubchem_id, temperature_k, solubility_mole_fraction,
                      log_s_mole_fraction, solubility_g_per_g100, log_s_g_per_g100,
                      fraction_solvent_1, fraction_type, source_doi, measurements_json,
                      units_json, raw_values_json
               FROM mixture_solubility
               WHERE solute_smiles = ? AND normalized_solvent_1 = ?
                 AND normalized_solvent_2 = ? AND fraction_solvent_1 IS ?
                 AND fraction_type IS ?""",
            (
                solute_smiles, normalize_identity(solvent_1), normalize_identity(solvent_2),
                fraction_solvent_1, normalize_identity(fraction_type),
            ),
            self._mixture_result,
        )

    def density(self, solvent: str, temperature_k: float) -> list[dict[str, Any]]:
        return self._query_measurements(
            """SELECT solvent, temperature_k, density_g_per_cm3, source_doi,
                      measurements_json, units_json, raw_values_json
               FROM density
               WHERE normalized_solvent = ? AND temperature_k IS ?""",
            (normalize_identity(solvent), temperature_k),
            self._density_result,
        )

    def _query_measurements(self, query: str, parameters: tuple[Any, ...], convert: Any) -> list[dict[str, Any]]:
        with self._connect() as connection:
            return [convert(row) for row in connection.execute(query, parameters)]

    def _validate(self) -> None:
        if not self.path.is_file():
            raise SolventEvidenceUnavailableError(f"CHEM21 index is unavailable at {self.path}")
        try:
            with self._connect() as connection:
                integrity = connection.execute("PRAGMA integrity_check").fetchone()
                schema = connection.execute(
                    "SELECT value FROM schema_metadata WHERE key = 'schema_version'"
                ).fetchone()
        except sqlite3.Error as exc:
            raise SolventEvidenceUnavailableError(f"CHEM21 index is unavailable: {exc}") from exc
        if integrity is None or integrity[0] != "ok" or schema is None or schema[0] != "1":
            raise SolventEvidenceUnavailableError("CHEM21 index is unavailable: invalid schema or integrity check")

    def _connect(self) -> sqlite3.Connection:
        try:
            connection = sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True)
        except (OSError, sqlite3.Error) as exc:
            raise SolventEvidenceUnavailableError(f"CHEM21 index is unavailable: {exc}") from exc
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _single_result(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "solute_smiles": row["solute_smiles"],
            "solvent": row["solvent"],
            "solvent_smiles": row["solvent_smiles"],
            "compound_name": row["compound_name"],
            "cas": row["cas"],
            "pubchem_id": row["pubchem_id"],
            "temperature_k": row["temperature_k"],
            "solubility_mole_fraction": row["solubility_mole_fraction"],
            "solubility_mol_per_l": row["solubility_mol_per_l"],
            "log_s_mol_per_l": row["log_s_mol_per_l"],
            "source": row["source_doi"],
            "measurements": json.loads(row["measurements_json"]),
            "units": json.loads(row["units_json"]),
            "raw_values": json.loads(row["raw_values_json"]),
        }

    @staticmethod
    def _mixture_result(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "solute_smiles": row["solute_smiles"],
            "solvent_1": row["solvent_1"],
            "solvent_2": row["solvent_2"],
            "solvent_1_smiles": row["solvent_1_smiles"],
            "solvent_2_smiles": row["solvent_2_smiles"],
            "compound_name": row["compound_name"],
            "cas": row["cas"],
            "pubchem_id": row["pubchem_id"],
            "temperature_k": row["temperature_k"],
            "solubility_mole_fraction": row["solubility_mole_fraction"],
            "log_s_mole_fraction": row["log_s_mole_fraction"],
            "solubility_g_per_g100": row["solubility_g_per_g100"],
            "log_s_g_per_g100": row["log_s_g_per_g100"],
            "fraction_solvent_1": row["fraction_solvent_1"],
            "fraction_type": row["fraction_type"],
            "source": row["source_doi"],
            "measurements": json.loads(row["measurements_json"]),
            "units": json.loads(row["units_json"]),
            "raw_values": json.loads(row["raw_values_json"]),
        }

    @staticmethod
    def _density_result(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "solvent": row["solvent"],
            "temperature_k": row["temperature_k"],
            "density_g_per_cm3": row["density_g_per_cm3"],
            "source": row["source_doi"],
            "measurements": json.loads(row["measurements_json"]),
            "units": json.loads(row["units_json"]),
            "raw_values": json.loads(row["raw_values_json"]),
        }


_DEFAULT_INDEX_PATH = Path(__file__).parent / "data" / "solvent-evidence" / "solvent-evidence.sqlite"
_default_store: SolventEvidenceStore | None = None


def get_store() -> SolventEvidenceStore:
    """Return the process-local validated default store without caching failures."""
    global _default_store
    if _default_store is None:
        _default_store = SolventEvidenceStore(_DEFAULT_INDEX_PATH)
    return _default_store
