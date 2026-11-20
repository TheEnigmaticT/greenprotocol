"""Shared role vocabulary for the deterministic scorers.

Role labels reach the scorers from two directions: the protocol parser and
the TypeScript service.  They do not agree on vocabulary, so the scorers
agree on one normalized set here and a chemical is classified the same way in
every principle.

  * ``PRODUCT_ROLES`` — declared output roles.  P4 evaluates them for product
    toxicity; P1/P7/P9 must not count them as inputs.  P4 re-exports this
    name because downstream consumers import it from there.
  * ``BYPRODUCT_ROLES`` — co-products are outputs as well.
  * ``SOLVENT_ROLES`` — the explicit solvent family.
  * ``WORKUP_ROLES`` — legacy workup labels.  A workup label alone does not
    make a chemical a solvent; the curated CHEM21 identity decides.

The canonical process-use vocabulary produced by the TypeScript service is
``reaction`` / ``extraction`` / ``wash`` / ``quench`` / ``drying`` (plus
``other``); ``workup_solvent`` is the legacy alias.  Process use is recorded
context, never a blanket disqualifier.
"""

from __future__ import annotations


# Declared outputs.  Content kept stable: downstream consumers import this
# name from ``scoring.p4_product_toxicity``.
PRODUCT_ROLES = {
    "product",
    "desired product",
    "target",
    "intermediate",
    "final product",
    "main product",
}

# Co-products are outputs too.
BYPRODUCT_ROLES = {
    "byproduct",
    "by-product",
    "coproduct",
    "co-product",
}

# Everything that is an output rather than an input.
OUTPUT_ROLES = PRODUCT_ROLES | BYPRODUCT_ROLES

# The explicit solvent family.
SOLVENT_ROLES = {
    "solvent",
    "co-solvent",
    "washing solvent",
    "auxiliary",
}

# Legacy workup labels, including the legacy ``workup_solvent`` alias.
WORKUP_ROLES = {
    "workup",
    "workup_solvent",
    "wash",
    "washing",
    "extraction",
}

# Canonical process-use values from the TypeScript service.
CANONICAL_PROCESS_USE = {
    "reaction",
    "extraction",
    "wash",
    "quench",
    "drying",
    "other",
}

# Legacy process-use aliases, kept for compatibility.
LEGACY_PROCESS_USE = {"workup", "workup_solvent"}


def normalize_role(role: str | None) -> str:
    """Lower-case and strip a role label; ``None`` becomes an empty string."""
    return (role or "").strip().lower()


def is_product_role(role: str | None) -> bool:
    """True when the label denotes a declared output rather than an input."""
    normalized = normalize_role(role)
    return bool(normalized) and normalized in OUTPUT_ROLES


def is_solvent_role(role: str | None) -> bool:
    """True when the label is in the explicit solvent family."""
    normalized = normalize_role(role)
    return bool(normalized) and normalized in SOLVENT_ROLES


def is_workup_role(role: str | None) -> bool:
    """True for legacy workup labels (identity still decides solvency)."""
    normalized = normalize_role(role)
    return bool(normalized) and normalized in WORKUP_ROLES
