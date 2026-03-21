"""Common chemical abbreviations and synonyms used in lab protocols."""

# Maps common abbreviations to PubChem-resolvable names
CHEMICAL_SYNONYMS: dict[str, str] = {
    # Solvents
    "dmf": "N,N-Dimethylformamide",
    "dcm": "Dichloromethane",
    "thf": "Tetrahydrofuran",
    "meoh": "Methanol",
    "etoh": "Ethanol",
    "ether": "Diethyl ether",
    "et2o": "Diethyl ether",
    "dmso": "Dimethyl sulfoxide",
    "dioxane": "1,4-Dioxane",
    "acetone": "Acetone",
    "acn": "Acetonitrile",
    "mecn": "Acetonitrile",
    "toluene": "Toluene",
    "hexane": "Hexane",
    "hexanes": "Hexane",
    "pentane": "Pentane",
    "etoac": "Ethyl acetate",
    "ethyl acetate": "Ethyl acetate",
    "nmp": "N-Methyl-2-pyrrolidone",
    "dma": "N,N-Dimethylacetamide",
    "ipoh": "Isopropanol",
    "ipa": "Isopropanol",
    "2-propanol": "Isopropanol",
    "isopropanol": "Isopropanol",
    "buoh": "1-Butanol",
    "chloroform": "Chloroform",
    "chcl3": "Chloroform",
    "carbon tetrachloride": "Carbon tetrachloride",
    "ccl4": "Carbon tetrachloride",
    "water": "Water",
    "h2o": "Water",
    "deionized water": "Water",
    "di water": "Water",
    "milli-q water": "Water",
    "cyrene": "Dihydrolevoglucosenone",
    "nbp": "N-Butylpyrrolidinone",

    # Acids & bases
    "hcl": "Hydrochloric acid",
    "h2so4": "Sulfuric acid",
    "hno3": "Nitric acid",
    "acoh": "Acetic acid",
    "acetic acid": "Acetic acid",
    "tfa": "Trifluoroacetic acid",
    "naoh": "Sodium hydroxide",
    "koh": "Potassium hydroxide",
    "triethylamine": "Triethylamine",
    "tea": "Triethylamine",
    "et3n": "Triethylamine",
    "dipea": "N,N-Diisopropylethylamine",
    "diea": "N,N-Diisopropylethylamine",
    "hunig's base": "N,N-Diisopropylethylamine",

    # Coupling & peptide chemistry
    "hbtu": "HBTU",
    "hatu": "HATU",
    "edc": "EDC",
    "dcc": "N,N'-Dicyclohexylcarbodiimide",
    "hobt": "Hydroxybenzotriazole",
    "fmoc": "Fmoc chloride",
    "boc": "Di-tert-butyl dicarbonate",
    "boc2o": "Di-tert-butyl dicarbonate",
    "piperidine": "Piperidine",

    # Common reagents
    "nabh4": "Sodium borohydride",
    "lialh4": "Lithium aluminium hydride",
    "pd/c": "Palladium on carbon",
    "pd(pph3)4": "Tetrakis(triphenylphosphine)palladium(0)",
    "cuso4": "Copper(II) sulfate",
    "sodium ascorbate": "Sodium ascorbate",
    "sodium azide": "Sodium azide",
    "nan3": "Sodium azide",
    "k2co3": "Potassium carbonate",
    "na2so4": "Sodium sulfate",
    "mgso4": "Magnesium sulfate",
    "nacl": "Sodium chloride",
    "nh4cl": "Ammonium chloride",

    # Salicylic acid demo
    "salicylic acid": "Salicylic acid",
    "acetic anhydride": "Acetic anhydride",
    "phosphoric acid": "Phosphoric acid",
    "h3po4": "Phosphoric acid",
}


def resolve_synonym(name: str) -> str:
    """Resolve a chemical abbreviation to its canonical name.
    
    Returns the canonical name if found, otherwise returns the original name.
    """
    return CHEMICAL_SYNONYMS.get(name.lower().strip(), name)
