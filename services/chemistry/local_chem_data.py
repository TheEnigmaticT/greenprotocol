"""Local fallback chemistry data for common protocol chemicals.

Used when PubChem is unavailable from hosted infrastructure.
"""

LOCAL_PROPERTIES: dict[str, dict] = {
    "water": {
        "cid": 962,
        "molecular_weight": 18.015,
        "molecular_formula": "H2O",
        "canonical_smiles": "O",
        "isomeric_smiles": "O",
        "density_g_per_ml": 0.997,
    },
    "ethanol": {
        "cid": 702,
        "molecular_weight": 46.069,
        "molecular_formula": "C2H6O",
        "canonical_smiles": "CCO",
        "isomeric_smiles": "CCO",
        "density_g_per_ml": 0.789,
    },
    "methanol": {
        "cid": 887,
        "molecular_weight": 32.042,
        "molecular_formula": "CH4O",
        "canonical_smiles": "CO",
        "isomeric_smiles": "CO",
        "density_g_per_ml": 0.792,
    },
    "acetone": {
        "cid": 180,
        "molecular_weight": 58.08,
        "molecular_formula": "C3H6O",
        "canonical_smiles": "CC(=O)C",
        "isomeric_smiles": "CC(=O)C",
        "density_g_per_ml": 0.784,
    },
    "n,n-dimethylformamide": {
        "cid": 6228,
        "molecular_weight": 73.095,
        "molecular_formula": "C3H7NO",
        "canonical_smiles": "CN(C)C=O",
        "isomeric_smiles": "CN(C)C=O",
        "density_g_per_ml": 0.944,
    },
    "dichloromethane": {
        "cid": 6344,
        "molecular_weight": 84.93,
        "molecular_formula": "CH2Cl2",
        "canonical_smiles": "C(Cl)Cl",
        "isomeric_smiles": "C(Cl)Cl",
        "density_g_per_ml": 1.326,
    },
    "tetrahydrofuran": {
        "cid": 8028,
        "molecular_weight": 72.107,
        "molecular_formula": "C4H8O",
        "canonical_smiles": "C1CCOC1",
        "isomeric_smiles": "C1CCOC1",
        "density_g_per_ml": 0.889,
    },
    "acetonitrile": {
        "cid": 6342,
        "molecular_weight": 41.053,
        "molecular_formula": "C2H3N",
        "canonical_smiles": "CC#N",
        "isomeric_smiles": "CC#N",
        "density_g_per_ml": 0.786,
    },
    "toluene": {
        "cid": 1140,
        "molecular_weight": 92.141,
        "molecular_formula": "C7H8",
        "canonical_smiles": "CC1=CC=CC=C1",
        "isomeric_smiles": "CC1=CC=CC=C1",
        "density_g_per_ml": 0.867,
    },
    "hexane": {
        "cid": 8058,
        "molecular_weight": 86.178,
        "molecular_formula": "C6H14",
        "canonical_smiles": "CCCCCC",
        "isomeric_smiles": "CCCCCC",
        "density_g_per_ml": 0.655,
    },
    "ethyl acetate": {
        "cid": 8857,
        "molecular_weight": 88.106,
        "molecular_formula": "C4H8O2",
        "canonical_smiles": "CCOC(=O)C",
        "isomeric_smiles": "CCOC(=O)C",
        "density_g_per_ml": 0.902,
    },
    "dimethyl sulfoxide": {
        "cid": 679,
        "molecular_weight": 78.13,
        "molecular_formula": "C2H6OS",
        "canonical_smiles": "CS(=O)C",
        "isomeric_smiles": "CS(=O)C",
        "density_g_per_ml": 1.10,
    },
    "chloroform": {
        "cid": 6212,
        "molecular_weight": 119.37,
        "molecular_formula": "CHCl3",
        "canonical_smiles": "C(Cl)(Cl)Cl",
        "isomeric_smiles": "C(Cl)(Cl)Cl",
        "density_g_per_ml": 1.489,
    },
    "acetic acid": {
        "cid": 176,
        "molecular_weight": 60.052,
        "molecular_formula": "C2H4O2",
        "canonical_smiles": "CC(=O)O",
        "isomeric_smiles": "CC(=O)O",
        "density_g_per_ml": 1.049,
    },
    "triethylamine": {
        "cid": 8471,
        "molecular_weight": 101.19,
        "molecular_formula": "C6H15N",
        "canonical_smiles": "CCN(CC)CC",
        "isomeric_smiles": "CCN(CC)CC",
        "density_g_per_ml": 0.726,
    },
}

LOCAL_HCODES_BY_CID: dict[int, list[str]] = {
    702: ["H225", "H319"],
    887: ["H225", "H301", "H311", "H331", "H370"],
    180: ["H225", "H319", "H336"],
    6228: ["H226", "H312", "H319", "H360D"],
    6344: ["H315", "H319", "H335", "H336", "H351"],
    8028: ["H225", "H319", "H335", "H351"],
    6342: ["H225", "H302", "H312", "H319", "H332"],
    1140: ["H225", "H304", "H315", "H336", "H361", "H373"],
    8058: ["H225", "H304", "H315", "H336", "H361", "H373", "H411"],
    8857: ["H225", "H319", "H336"],
    6212: ["H302", "H315", "H319", "H331", "H351", "H361", "H372"],
    176: ["H226", "H314"],
    8471: ["H225", "H302", "H312", "H314", "H332"],
}


def lookup_local_properties(name: str) -> dict | None:
    return LOCAL_PROPERTIES.get(name.lower().strip())


def lookup_local_hcodes(cid: int) -> list[str]:
    return LOCAL_HCODES_BY_CID.get(cid, [])
