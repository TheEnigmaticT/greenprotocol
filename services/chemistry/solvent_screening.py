"""Server-side gates for local solvent evidence screening."""

from __future__ import annotations

import math
from decimal import Decimal
from dataclasses import dataclass
from typing import Any

from chem21 import CHEM21_CITATION
from solvent_evidence_store import HazardProfile, SolventEvidenceStore, get_store

try:
    from rdkit import Chem
except ImportError:  # pragma: no cover - chemistry service requires RDKit
    Chem = None


VALIDATION_WARNING = (
    "Laboratory validation required: confirm compatibility, rate, selectivity, "
    "catalyst effects, workup, crystallization, and scale-up before any solvent change."
)


@dataclass(frozen=True)
class ScreeningCandidate:
    """A local measurement-supported experimental screening candidate, not an endorsement."""

    solvent: str
    solubility_mole_fraction: float
    current_solubility_mole_fraction: float
    recommendation: str
    current_measurements: tuple[dict[str, Any], ...]
    candidate_measurements: tuple[dict[str, Any], ...]
    hazard_comparison: dict[str, dict[str, int]]
    citations: list[dict[str, str]]
    chem21_relation: str | None
    warnings: list[str]


def normalize_smiles(smiles: str) -> str | None:
    """Return a local RDKit-normalized structure, or None for malformed input."""
    if Chem is None or not isinstance(smiles, str) or not smiles.strip():
        return None
    molecule = Chem.MolFromSmiles(smiles)
    return Chem.MolToSmiles(molecule, canonical=True) if molecule is not None else None


def is_strict_hazard_improvement(current: HazardProfile, candidate: HazardProfile) -> bool:
    """Allow only a strict partial-order improvement across GHS categories."""
    current_levels = current.category_levels()
    candidate_levels = candidate.category_levels()
    return (
        all(candidate_levels[key] <= current_levels[key] for key in current_levels)
        and any(candidate_levels[key] < current_levels[key] for key in current_levels)
    )


def screen_candidates(
    solute_smiles: str,
    current_solvent: str,
    temperature_k: float,
    *,
    store: SolventEvidenceStore | None = None,
) -> list[ScreeningCandidate]:
    """Return only CHEM21-linked candidates that clear every local evidence gate."""
    normalized_solute = normalize_smiles(solute_smiles)
    if normalized_solute is None or not _valid_identity(current_solvent) or not _finite_temperature(temperature_k):
        return []

    evidence_store = store or get_store()
    current_chem21 = evidence_store.lookup_chem21(current_solvent)
    if current_chem21 is None:
        return []
    replacements = current_chem21.get("replacements", [])
    if not isinstance(replacements, list) or not replacements:
        return []

    current_rows, current_truncated = evidence_store.screening_solubility(
        normalized_solute, current_solvent, temperature_k, limit=20
    )
    current_measurements = _matching_measurements(current_rows, normalized_solute, temperature_k)
    current_truncated = current_truncated or len(current_measurements) > 20
    if not current_measurements:
        return []
    current_profile = evidence_store.hazard_profile(current_solvent)
    if current_profile is None:
        return []

    candidates: list[ScreeningCandidate] = []
    for replacement in replacements:
        if not _valid_identity(replacement):
            continue
        candidate_rows, candidate_truncated = evidence_store.screening_solubility(
            normalized_solute, replacement, temperature_k, limit=20
        )
        candidate_measurements = _matching_measurements(candidate_rows, normalized_solute, temperature_k)
        candidate_truncated = candidate_truncated or len(candidate_measurements) > 20
        if not candidate_measurements:
            continue
        candidate_profile = evidence_store.hazard_profile(replacement)
        if candidate_profile is None or not is_strict_hazard_improvement(current_profile, candidate_profile):
            continue

        current_solubility = _best_mole_fraction(current_measurements)
        candidate_solubility = _best_mole_fraction(candidate_measurements)
        if current_solubility is None or candidate_solubility is None or candidate_solubility < current_solubility:
            continue

        candidate_name = candidate_measurements[0]["solvent"]
        warnings = [VALIDATION_WARNING]
        if current_truncated or candidate_truncated:
            warnings.append("Results were truncated to the first 20 raw measurements.")
        candidates.append(
            ScreeningCandidate(
                solvent=candidate_name,
                solubility_mole_fraction=candidate_solubility,
                current_solubility_mole_fraction=current_solubility,
                recommendation="laboratory_screening",
                current_measurements=tuple(current_measurements[:20]),
                candidate_measurements=tuple(candidate_measurements[:20]),
                hazard_comparison={
                    category: {
                        "current": current_profile.category_levels()[category],
                        "candidate": candidate_profile.category_levels()[category],
                    }
                    for category in current_profile.category_levels()
                },
                citations=_citations(
                    current_measurements,
                    candidate_measurements,
                    current_profile,
                    candidate_profile,
                ),
                chem21_relation=(
                    f"CHEM21 lists {candidate_name} as a replacement for {current_chem21['name']}."
                ),
                warnings=warnings,
            )
        )
    return candidates


def _matching_measurements(
    measurements: list[dict[str, Any]], normalized_solute: str, temperature_k: float
) -> list[dict[str, Any]]:
    return [
        measurement
        for measurement in measurements
        if normalize_smiles(measurement.get("solute_smiles", "")) == normalized_solute
        and _finite_temperature(measurement.get("temperature_k"))
        and _within_temperature_window(measurement["temperature_k"], temperature_k)
        and _finite_number(measurement.get("solubility_mole_fraction"))
    ]


def _within_temperature_window(measured: float, requested: float) -> bool:
    return abs(Decimal(str(measured)) - Decimal(str(requested))) <= Decimal("0.01")


def _best_mole_fraction(measurements: list[dict[str, Any]]) -> float | None:
    values = [float(measurement["solubility_mole_fraction"]) for measurement in measurements]
    return max(values) if values else None


def _citations(
    current_measurements: list[dict[str, Any]],
    candidate_measurements: list[dict[str, Any]],
    current_profile: HazardProfile,
    candidate_profile: HazardProfile,
) -> list[dict[str, str]]:
    citations: list[dict[str, str]] = [CHEM21_CITATION.copy()]
    for measurement in (*current_measurements, *candidate_measurements):
        source = measurement.get("source")
        if isinstance(source, str) and source:
            citations.append({"source": source})
    for profile in (current_profile, candidate_profile):
        citations.append(
            {
                "source": profile.source_url,
                "snapshot_path": profile.snapshot_path,
                "snapshot_sha256": profile.snapshot_sha256,
                "retrieved_at": profile.retrieved_at,
            }
        )
    return [dict(citation) for citation in dict.fromkeys(
        tuple(sorted(citation.items())) for citation in citations
    )]


def _finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _finite_temperature(value: object) -> bool:
    return _finite_number(value)


def _valid_identity(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and len(value.strip()) <= 200
        and not any(character in value for character in "\x00\r\n")
    )
