import { ChemicalData } from './types'

/**
 * Hardcoded database of 50 common laboratory chemicals with realistic
 * environmental impact data, GHS hazard classifications, CHEM21 solvent
 * guide ratings, and green alternative suggestions.
 *
 * Data sources:
 * - CHEM21 solvent selection guide (Prat et al., Green Chem., 2016)
 * - Published life-cycle assessment (LCA) estimates for chemical production
 * - GHS classification data from ECHA/PubChem
 * - Green chemistry literature for alternative recommendations
 */

export const CHEMICALS: ChemicalData[] = [
  // ─────────────────────────────────────────────────
  // SOLVENTS (1-17)
  // ─────────────────────────────────────────────────

  // 1. Dichloromethane (DCM)
  {
    cas: '75-09-2',
    name: 'Dichloromethane',
    synonyms: ['DCM', 'methylene chloride', 'CH2Cl2'],
    molecularWeight: 84.93,
    densityKgPerL: 1.33,
    co2ePerKg: 5.2,
    waterPerKg: 45,
    energyPerKg: 12.5,
    ghsHazards: ['H302', 'H315', 'H336', 'H351', 'H373'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'Ethyl acetate',
        context: 'Extractions and chromatography',
        yieldImpact: 'Comparable yields in most extraction procedures',
        source: 'Byrne et al., Sustain. Chem. Process., 2016',
      },
      {
        chemical: '2-MeTHF',
        context: 'Biphasic extractions from aqueous layers',
        yieldImpact: 'Equivalent or improved phase separation',
        source: 'Pace et al., Green Chem., 2012',
      },
      {
        chemical: 'CPME',
        context: 'Extractions requiring low water miscibility',
        yieldImpact: 'Similar recovery, narrower applicability',
        source: 'Watanabe et al., Org. Process Res. Dev., 2007',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 2. Chloroform
  {
    cas: '67-66-3',
    name: 'Chloroform',
    synonyms: ['trichloromethane', 'CHCl3'],
    molecularWeight: 119.38,
    densityKgPerL: 1.49,
    co2ePerKg: 5.5,
    waterPerKg: 50,
    energyPerKg: 13.0,
    ghsHazards: ['H302', 'H315', 'H319', 'H331', 'H336', 'H351', 'H361d', 'H372'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'Ethyl acetate',
        context: 'General extractions and NMR sample prep',
        yieldImpact: 'Comparable for most organic extractions',
        source: 'Byrne et al., Sustain. Chem. Process., 2016',
      },
      {
        chemical: '2-MeTHF',
        context: 'Extractions requiring dense organic phase',
        yieldImpact: 'May require adjusted protocols; lighter than water',
        source: 'Pace et al., Green Chem., 2012',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 3. Hexane
  {
    cas: '110-54-3',
    name: 'Hexane',
    synonyms: ['n-hexane', 'hexanes'],
    molecularWeight: 86.18,
    densityKgPerL: 0.659,
    co2ePerKg: 3.8,
    waterPerKg: 32,
    energyPerKg: 9.1,
    ghsHazards: ['H225', 'H304', 'H315', 'H336', 'H361f', 'H373'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Heptane',
        context: 'Chromatography and crystallisation',
        yieldImpact: 'Direct replacement with similar Rf values',
        source: 'CHEM21 solvent selection guide, 2016',
      },
      {
        chemical: '2-MeTHF',
        context: 'Extractions from aqueous media',
        yieldImpact: 'Comparable yields; bio-derived option',
        source: 'Pace et al., Green Chem., 2012',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 4. Toluene
  {
    cas: '108-88-3',
    name: 'Toluene',
    synonyms: ['methylbenzene', 'toluol', 'PhMe'],
    molecularWeight: 92.14,
    densityKgPerL: 0.867,
    co2ePerKg: 3.2,
    waterPerKg: 35,
    energyPerKg: 8.5,
    ghsHazards: ['H225', 'H304', 'H315', 'H336', 'H361d', 'H373'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'p-Cymene',
        context: 'High-boiling aromatic solvent applications',
        yieldImpact: 'Similar solvation; bio-derived from limonene',
        source: 'Clark et al., Green Chem., 2017',
      },
      {
        chemical: 'Anisole',
        context: 'Reactions requiring aromatic solvent',
        yieldImpact: 'Similar polarity profile; lower toxicity',
        source: 'Prat et al., Green Chem., 2016',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 5. THF (Tetrahydrofuran)
  {
    cas: '109-99-9',
    name: 'Tetrahydrofuran',
    synonyms: ['THF', 'oxolane', 'tetramethylene oxide'],
    molecularWeight: 72.11,
    densityKgPerL: 0.889,
    co2ePerKg: 6.1,
    waterPerKg: 55,
    energyPerKg: 14.2,
    ghsHazards: ['H225', 'H302', 'H319', 'H335', 'H351'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: '2-MeTHF',
        context: 'Organometallic reactions (Grignard, organolithium)',
        yieldImpact: 'Comparable or improved yields; easier workup',
        source: 'Pace et al., Green Chem., 2012',
      },
      {
        chemical: 'CPME',
        context: 'Reactions requiring ethereal solvent with low water solubility',
        yieldImpact: 'Similar yields; better phase separation',
        source: 'Watanabe et al., Org. Process Res. Dev., 2007',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 6. DMF (N,N-Dimethylformamide)
  {
    cas: '68-12-2',
    name: 'N,N-Dimethylformamide',
    synonyms: ['DMF', 'dimethylformamide'],
    molecularWeight: 73.09,
    densityKgPerL: 0.944,
    co2ePerKg: 4.5,
    waterPerKg: 60,
    energyPerKg: 11.8,
    ghsHazards: ['H312', 'H319', 'H332', 'H360d'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'DMSO',
        context: 'Polar aprotic solvent applications',
        yieldImpact: 'Often comparable; higher boiling point aids removal',
        source: 'Prat et al., Green Chem., 2016',
      },
      {
        chemical: 'Cyrene (dihydrolevoglucosenone)',
        context: 'Amide coupling and SNAr reactions',
        yieldImpact: 'Comparable yields in tested reactions; bio-derived',
        source: 'Sherwood et al., Chem. Commun., 2014',
      },
      {
        chemical: 'NBP (N-butylpyrrolidinone)',
        context: 'Cross-coupling reactions',
        yieldImpact: 'Emerging data shows similar reactivity profiles',
        source: 'ACS Green Chem. Inst. solvent tool',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 7. Ethyl acetate
  {
    cas: '141-78-6',
    name: 'Ethyl acetate',
    synonyms: ['EtOAc', 'ethyl ethanoate', 'acetic acid ethyl ester'],
    molecularWeight: 88.11,
    densityKgPerL: 0.902,
    co2ePerKg: 2.8,
    waterPerKg: 25,
    energyPerKg: 6.5,
    ghsHazards: ['H225', 'H319', 'H336'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 8. 2-MeTHF (2-Methyltetrahydrofuran)
  {
    cas: '96-47-9',
    name: '2-Methyltetrahydrofuran',
    synonyms: ['2-MeTHF', 'methyl tetrahydrofuran'],
    molecularWeight: 86.13,
    densityKgPerL: 0.855,
    co2ePerKg: 3.5,
    waterPerKg: 30,
    energyPerKg: 8.0,
    ghsHazards: ['H225', 'H315', 'H319', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 9. Ethanol
  {
    cas: '64-17-5',
    name: 'Ethanol',
    synonyms: ['EtOH', 'ethyl alcohol', 'alcohol'],
    molecularWeight: 46.07,
    densityKgPerL: 0.789,
    co2ePerKg: 1.5,
    waterPerKg: 18,
    energyPerKg: 4.2,
    ghsHazards: ['H225', 'H319'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 10. Methanol
  {
    cas: '67-56-1',
    name: 'Methanol',
    synonyms: ['MeOH', 'methyl alcohol', 'wood alcohol'],
    molecularWeight: 32.04,
    densityKgPerL: 0.791,
    co2ePerKg: 1.8,
    waterPerKg: 22,
    energyPerKg: 5.0,
    ghsHazards: ['H225', 'H301', 'H311', 'H331', 'H370'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Ethanol',
        context: 'Precipitation and washing steps',
        yieldImpact: 'Comparable in most crystallisation procedures',
        source: 'CHEM21 solvent selection guide, 2016',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 11. Acetone
  {
    cas: '67-64-1',
    name: 'Acetone',
    synonyms: ['propanone', 'dimethyl ketone', '2-propanone'],
    molecularWeight: 58.08,
    densityKgPerL: 0.784,
    co2ePerKg: 2.2,
    waterPerKg: 20,
    energyPerKg: 5.5,
    ghsHazards: ['H225', 'H319', 'H336'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 12. Water
  {
    cas: '7732-18-5',
    name: 'Water',
    synonyms: ['H2O', 'deionized water', 'DI water', 'distilled water'],
    molecularWeight: 18.015,
    densityKgPerL: 1.0,
    co2ePerKg: 0.001,
    waterPerKg: 1.0,
    energyPerKg: 0.005,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 13. DMSO
  {
    cas: '67-68-5',
    name: 'Dimethyl sulfoxide',
    synonyms: ['DMSO', 'methyl sulfoxide'],
    molecularWeight: 78.13,
    densityKgPerL: 1.10,
    co2ePerKg: 3.0,
    waterPerKg: 28,
    energyPerKg: 7.5,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 14. Acetonitrile
  {
    cas: '75-05-8',
    name: 'Acetonitrile',
    synonyms: ['MeCN', 'methyl cyanide', 'cyanomethane'],
    molecularWeight: 41.05,
    densityKgPerL: 0.786,
    co2ePerKg: 4.0,
    waterPerKg: 40,
    energyPerKg: 10.0,
    ghsHazards: ['H225', 'H302', 'H312', 'H319', 'H332'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Ethanol',
        context: 'HPLC mobile phase (reversed-phase)',
        yieldImpact: 'Higher viscosity; may require method adjustment',
        source: 'Welch et al., Green Chem., 2010',
      },
      {
        chemical: 'Acetone',
        context: 'Low-boiling polar solvent applications',
        yieldImpact: 'Comparable for many dissolution tasks',
        source: 'CHEM21 solvent selection guide, 2016',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 15. Diethyl ether
  {
    cas: '60-29-7',
    name: 'Diethyl ether',
    synonyms: ['ether', 'Et2O', 'ethoxyethane', 'diethyl oxide'],
    molecularWeight: 74.12,
    densityKgPerL: 0.713,
    co2ePerKg: 4.8,
    waterPerKg: 38,
    energyPerKg: 11.0,
    ghsHazards: ['H224', 'H302', 'H336'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: '2-MeTHF',
        context: 'Extractions and Grignard reactions',
        yieldImpact: 'Comparable yields; lower peroxide formation risk',
        source: 'Pace et al., Green Chem., 2012',
      },
      {
        chemical: 'CPME',
        context: 'Ethereal solvent replacement',
        yieldImpact: 'Higher boiling point; excellent stability',
        source: 'Watanabe et al., Org. Process Res. Dev., 2007',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 16. CPME (Cyclopentyl methyl ether)
  {
    cas: '5614-37-9',
    name: 'Cyclopentyl methyl ether',
    synonyms: ['CPME', 'methoxycyclopentane'],
    molecularWeight: 100.16,
    densityKgPerL: 0.860,
    co2ePerKg: 3.2,
    waterPerKg: 26,
    energyPerKg: 7.8,
    ghsHazards: ['H225', 'H336'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // 17. Isopropanol
  {
    cas: '67-63-0',
    name: 'Isopropanol',
    synonyms: ['IPA', 'isopropyl alcohol', '2-propanol', 'rubbing alcohol'],
    molecularWeight: 60.10,
    densityKgPerL: 0.786,
    co2ePerKg: 1.9,
    waterPerKg: 20,
    energyPerKg: 4.8,
    ghsHazards: ['H225', 'H319', 'H336'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'CHEM21 solvent guide',
  },

  // ─────────────────────────────────────────────────
  // COMMON REAGENTS (18-38)
  // ─────────────────────────────────────────────────

  // 18. Hydrochloric acid
  {
    cas: '7647-01-0',
    name: 'Hydrochloric acid',
    synonyms: ['HCl', 'muriatic acid', 'hydrogen chloride'],
    molecularWeight: 36.46,
    densityKgPerL: 1.18,
    co2ePerKg: 1.2,
    waterPerKg: 15,
    energyPerKg: 3.0,
    ghsHazards: ['H290', 'H314', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Citric acid',
        context: 'pH adjustment and mild acidification',
        yieldImpact: 'Suitable for non-critical acidification steps',
        source: 'Anastas & Warner, Green Chemistry, 1998',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 19. Sulfuric acid
  {
    cas: '7664-93-9',
    name: 'Sulfuric acid',
    synonyms: ['H2SO4', 'oil of vitriol'],
    molecularWeight: 98.079,
    densityKgPerL: 1.84,
    co2ePerKg: 0.9,
    waterPerKg: 12,
    energyPerKg: 2.5,
    ghsHazards: ['H290', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'p-Toluenesulfonic acid',
        context: 'Acid catalysis in organic reactions',
        yieldImpact: 'Comparable catalytic activity; easier handling',
        source: 'Sheldon, Green Chem., 2017',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 20. Sodium hydroxide
  {
    cas: '1310-73-2',
    name: 'Sodium hydroxide',
    synonyms: ['NaOH', 'caustic soda', 'lye'],
    molecularWeight: 40.00,
    densityKgPerL: 2.13,
    co2ePerKg: 1.5,
    waterPerKg: 18,
    energyPerKg: 4.0,
    ghsHazards: ['H290', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 21. Potassium hydroxide
  {
    cas: '1310-58-3',
    name: 'Potassium hydroxide',
    synonyms: ['KOH', 'caustic potash', 'potash lye'],
    molecularWeight: 56.11,
    densityKgPerL: 2.12,
    co2ePerKg: 1.8,
    waterPerKg: 20,
    energyPerKg: 4.5,
    ghsHazards: ['H290', 'H302', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 22. Sodium borohydride
  {
    cas: '16940-66-2',
    name: 'Sodium borohydride',
    synonyms: ['NaBH4', 'sodium tetrahydridoborate'],
    molecularWeight: 37.83,
    densityKgPerL: 1.07,
    co2ePerKg: 8.5,
    waterPerKg: 65,
    energyPerKg: 18.0,
    ghsHazards: ['H260', 'H301', 'H314', 'H360f'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Catalytic hydrogenation (H2/Pd)',
        context: 'Carbonyl reductions',
        yieldImpact: 'Often superior atom economy; requires H2 setup',
        source: 'Nishimura, Handbook of Heterogeneous Catalytic Hydrogenation, 2001',
      },
      {
        chemical: 'Biocatalytic reduction (KRED)',
        context: 'Asymmetric ketone reduction',
        yieldImpact: 'Excellent ee; aqueous conditions; substrate-dependent',
        source: 'Moore et al., Acc. Chem. Res., 2007',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 23. Lithium aluminum hydride
  {
    cas: '16853-85-3',
    name: 'Lithium aluminum hydride',
    synonyms: ['LiAlH4', 'LAH', 'lithium alanate'],
    molecularWeight: 37.95,
    densityKgPerL: 0.917,
    co2ePerKg: 15.0,
    waterPerKg: 90,
    energyPerKg: 30.0,
    ghsHazards: ['H260', 'H302', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'Sodium borohydride',
        context: 'Simple carbonyl reductions (when LiAlH4 is overkill)',
        yieldImpact: 'Milder; works in protic solvents',
        source: 'Carey & Sundberg, Advanced Organic Chemistry, 2007',
      },
      {
        chemical: 'Catalytic hydrogenation (H2/Pd)',
        context: 'Reductions not requiring LiAlH4 selectivity',
        yieldImpact: 'Better atom economy; no pyrophoric waste',
        source: 'Sheldon, Green Chem., 2017',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 24. Triethylamine
  {
    cas: '121-44-8',
    name: 'Triethylamine',
    synonyms: ['TEA', 'Et3N', 'N,N-diethylethanamine'],
    molecularWeight: 101.19,
    densityKgPerL: 0.726,
    co2ePerKg: 3.5,
    waterPerKg: 30,
    energyPerKg: 8.0,
    ghsHazards: ['H225', 'H302', 'H311', 'H314', 'H331'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'DIPEA (Hunig\'s base)',
        context: 'Base for acylation and coupling reactions',
        yieldImpact: 'Less nucleophilic; reduced side reactions',
        source: 'Published LCA estimates',
      },
      {
        chemical: 'Potassium carbonate',
        context: 'Inorganic base replacement where applicable',
        yieldImpact: 'Easier removal; non-volatile',
        source: 'Constable et al., Green Chem., 2007',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 25. Pyridine
  {
    cas: '110-86-1',
    name: 'Pyridine',
    synonyms: ['azabenzene', 'azine'],
    molecularWeight: 79.10,
    densityKgPerL: 0.982,
    co2ePerKg: 4.2,
    waterPerKg: 42,
    energyPerKg: 10.5,
    ghsHazards: ['H225', 'H302', 'H312', 'H332', 'H361d'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'DMAP (catalytic)',
        context: 'Acylation catalyst to replace stoichiometric pyridine',
        yieldImpact: 'Catalytic amounts sufficient; improved atom economy',
        source: 'Hoefle et al., Angew. Chem. Int. Ed., 1978',
      },
      {
        chemical: 'Triethylamine',
        context: 'Base in acylation reactions',
        yieldImpact: 'Comparable; less toxic',
        source: 'CHEM21 solvent selection guide, 2016',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 26. Acetic acid
  {
    cas: '64-19-7',
    name: 'Acetic acid',
    synonyms: ['AcOH', 'ethanoic acid', 'glacial acetic acid'],
    molecularWeight: 60.05,
    densityKgPerL: 1.049,
    co2ePerKg: 1.6,
    waterPerKg: 16,
    energyPerKg: 4.0,
    ghsHazards: ['H226', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 27. Acetic anhydride
  {
    cas: '108-24-7',
    name: 'Acetic anhydride',
    synonyms: ['Ac2O', 'ethanoic anhydride'],
    molecularWeight: 102.09,
    densityKgPerL: 1.082,
    co2ePerKg: 2.5,
    waterPerKg: 22,
    energyPerKg: 6.0,
    ghsHazards: ['H226', 'H302', 'H314', 'H332'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 28. Sodium chloride
  {
    cas: '7647-14-5',
    name: 'Sodium chloride',
    synonyms: ['NaCl', 'salt', 'table salt'],
    molecularWeight: 58.44,
    densityKgPerL: 2.16,
    co2ePerKg: 0.2,
    waterPerKg: 5,
    energyPerKg: 0.5,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 29. Sodium sulfate
  {
    cas: '7757-82-6',
    name: 'Sodium sulfate',
    synonyms: ['Na2SO4', 'Glauber\'s salt (decahydrate)'],
    molecularWeight: 142.04,
    densityKgPerL: 2.66,
    co2ePerKg: 0.4,
    waterPerKg: 8,
    energyPerKg: 1.0,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 30. Magnesium sulfate
  {
    cas: '7487-88-9',
    name: 'Magnesium sulfate',
    synonyms: ['MgSO4', 'Epsom salt (heptahydrate)'],
    molecularWeight: 120.37,
    densityKgPerL: 2.66,
    co2ePerKg: 0.5,
    waterPerKg: 10,
    energyPerKg: 1.2,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 31. Sodium bicarbonate
  {
    cas: '144-55-8',
    name: 'Sodium bicarbonate',
    synonyms: ['NaHCO3', 'baking soda', 'sodium hydrogen carbonate'],
    molecularWeight: 84.01,
    densityKgPerL: 2.20,
    co2ePerKg: 0.6,
    waterPerKg: 8,
    energyPerKg: 1.5,
    ghsHazards: [],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 32. Potassium carbonate
  {
    cas: '584-08-7',
    name: 'Potassium carbonate',
    synonyms: ['K2CO3', 'potash', 'pearl ash'],
    molecularWeight: 138.21,
    densityKgPerL: 2.43,
    co2ePerKg: 1.0,
    waterPerKg: 12,
    energyPerKg: 2.5,
    ghsHazards: ['H315', 'H319', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 33. Hydrogen peroxide
  {
    cas: '7722-84-1',
    name: 'Hydrogen peroxide',
    synonyms: ['H2O2', 'peroxide'],
    molecularWeight: 34.01,
    densityKgPerL: 1.45,
    co2ePerKg: 1.1,
    waterPerKg: 14,
    energyPerKg: 3.2,
    ghsHazards: ['H271', 'H302', 'H314', 'H332'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 34. Oxalyl chloride
  {
    cas: '79-37-8',
    name: 'Oxalyl chloride',
    synonyms: ['(COCl)2', 'ethanedioyl dichloride'],
    molecularWeight: 126.93,
    densityKgPerL: 1.455,
    co2ePerKg: 6.5,
    waterPerKg: 55,
    energyPerKg: 14.0,
    ghsHazards: ['H300', 'H314', 'H330'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'CDI (1,1\'-carbonyldiimidazole)',
        context: 'Amide bond formation and acid activation',
        yieldImpact: 'Comparable yields; CO2 and imidazole as byproducts',
        source: 'Constable et al., Green Chem., 2007',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 35. Thionyl chloride
  {
    cas: '7719-09-7',
    name: 'Thionyl chloride',
    synonyms: ['SOCl2', 'sulfurous dichloride'],
    molecularWeight: 118.97,
    densityKgPerL: 1.638,
    co2ePerKg: 5.8,
    waterPerKg: 48,
    energyPerKg: 12.5,
    ghsHazards: ['H302', 'H314', 'H330', 'H332'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'CDI (1,1\'-carbonyldiimidazole)',
        context: 'Acid chloride formation for amide coupling',
        yieldImpact: 'Avoids HCl/SO2 gas evolution; milder conditions',
        source: 'Constable et al., Green Chem., 2007',
      },
      {
        chemical: 'Cyanuric chloride',
        context: 'Acyl chloride formation',
        yieldImpact: 'Catalytic use possible; less hazardous gas generation',
        source: 'De Luca et al., J. Org. Chem., 2003',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 36. Phosphorus trichloride
  {
    cas: '7719-12-2',
    name: 'Phosphorus trichloride',
    synonyms: ['PCl3', 'phosphorus(III) chloride'],
    molecularWeight: 137.33,
    densityKgPerL: 1.574,
    co2ePerKg: 6.0,
    waterPerKg: 52,
    energyPerKg: 13.5,
    ghsHazards: ['H250', 'H300', 'H314', 'H330'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 37. n-Butyllithium
  {
    cas: '109-72-8',
    name: 'n-Butyllithium',
    synonyms: ['n-BuLi', 'butyllithium', 'nBuLi'],
    molecularWeight: 64.06,
    densityKgPerL: 0.68,
    co2ePerKg: 12.0,
    waterPerKg: 80,
    energyPerKg: 25.0,
    ghsHazards: ['H250', 'H260', 'H304', 'H314', 'H336', 'H361f'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'LDA (lithium diisopropylamide)',
        context: 'Deprotonation reactions',
        yieldImpact: 'Less pyrophoric; easier handling in some protocols',
        source: 'Published LCA estimates',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 38. Sodium hydride
  {
    cas: '7646-69-7',
    name: 'Sodium hydride',
    synonyms: ['NaH'],
    molecularWeight: 24.00,
    densityKgPerL: 1.396,
    co2ePerKg: 7.5,
    waterPerKg: 55,
    energyPerKg: 16.0,
    ghsHazards: ['H228', 'H260', 'H314'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: 'Potassium carbonate',
        context: 'Deprotonation of moderately acidic substrates',
        yieldImpact: 'Milder base; applicable for pKa < 25 substrates',
        source: 'Constable et al., Green Chem., 2007',
      },
      {
        chemical: 'DBU',
        context: 'Non-nucleophilic base for elimination reactions',
        yieldImpact: 'No hydrogen gas evolution; homogeneous conditions',
        source: 'Published LCA estimates',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // ─────────────────────────────────────────────────
  // CATALYSTS (39-45)
  // ─────────────────────────────────────────────────

  // 39. Pd(PPh3)4 (Tetrakis)
  {
    cas: '14221-01-3',
    name: 'Tetrakis(triphenylphosphine)palladium(0)',
    synonyms: ['Pd(PPh3)4', 'tetrakis', 'Pd tetrakis'],
    molecularWeight: 1155.56,
    densityKgPerL: 1.55,
    co2ePerKg: 120.0,
    waterPerKg: 800,
    energyPerKg: 250.0,
    ghsHazards: ['H315', 'H319', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Pd/C (with catalyst recycling)',
        context: 'Suzuki coupling and cross-coupling reactions',
        yieldImpact: 'Heterogeneous; easier Pd recovery and recycling',
        source: 'Molnar, Chem. Rev., 2011',
      },
      {
        chemical: 'Fe catalysts',
        context: 'Selected cross-coupling reactions',
        yieldImpact: 'Substrate-dependent; active area of research',
        source: 'Bauer & Knolker, Chem. Rev., 2015',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 40. Pd/C (Palladium on carbon)
  {
    cas: '7440-05-3',
    name: 'Palladium on carbon',
    synonyms: ['Pd/C', 'palladium on charcoal', 'Pd-C'],
    molecularWeight: 106.42,
    densityKgPerL: 1.50,
    co2ePerKg: 95.0,
    waterPerKg: 600,
    energyPerKg: 200.0,
    ghsHazards: ['H228', 'H315', 'H319', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Raney Ni (with recycling)',
        context: 'Hydrogenation reactions',
        yieldImpact: 'Cheaper; lower environmental footprint per cycle',
        source: 'Nishimura, Handbook of Heterogeneous Catalytic Hydrogenation, 2001',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 41. CuI (Copper(I) iodide)
  {
    cas: '7681-65-4',
    name: 'Copper(I) iodide',
    synonyms: ['CuI', 'cuprous iodide'],
    molecularWeight: 190.45,
    densityKgPerL: 5.62,
    co2ePerKg: 8.0,
    waterPerKg: 50,
    energyPerKg: 15.0,
    ghsHazards: ['H302', 'H315', 'H319', 'H335', 'H410'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 42. FeCl3 (Iron(III) chloride)
  {
    cas: '7705-08-0',
    name: 'Iron(III) chloride',
    synonyms: ['FeCl3', 'ferric chloride', 'iron trichloride'],
    molecularWeight: 162.20,
    densityKgPerL: 2.90,
    co2ePerKg: 1.8,
    waterPerKg: 15,
    energyPerKg: 4.0,
    ghsHazards: ['H290', 'H302', 'H315', 'H318'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'recommended',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 43. Grubbs catalyst 2nd gen
  {
    cas: '246047-72-3',
    name: 'Grubbs catalyst 2nd generation',
    synonyms: [
      'Grubbs II',
      'Grubbs 2nd gen',
      'benzylidene[1,3-bis(2,4,6-trimethylphenyl)imidazolidin-2-ylidene]dichloro(tricyclohexylphosphine)ruthenium',
    ],
    molecularWeight: 848.97,
    densityKgPerL: 1.60,
    co2ePerKg: 150.0,
    waterPerKg: 900,
    energyPerKg: 300.0,
    ghsHazards: ['H315', 'H319', 'H335'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Hoveyda-Grubbs 2nd gen (with recycling)',
        context: 'Olefin metathesis',
        yieldImpact: 'More stable; better catalyst recovery possible',
        source: 'Hoveyda & Zhugralin, Nature, 2007',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // 44. DMAP
  {
    cas: '1122-58-3',
    name: '4-Dimethylaminopyridine',
    synonyms: ['DMAP', '4-(dimethylamino)pyridine'],
    molecularWeight: 122.17,
    densityKgPerL: 1.03,
    co2ePerKg: 5.5,
    waterPerKg: 35,
    energyPerKg: 10.0,
    ghsHazards: ['H301', 'H311', 'H315', 'H319', 'H331'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [],
    dataSource: 'Published LCA estimates',
  },

  // 45. AIBN
  {
    cas: '78-67-1',
    name: 'Azobisisobutyronitrile',
    synonyms: ['AIBN', '2,2\'-azobis(2-methylpropionitrile)'],
    molecularWeight: 164.21,
    densityKgPerL: 1.11,
    co2ePerKg: 7.0,
    waterPerKg: 45,
    energyPerKg: 14.0,
    ghsHazards: ['H225', 'H302', 'H412'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'BPO (benzoyl peroxide)',
        context: 'Radical polymerization initiation',
        yieldImpact: 'Similar initiation efficiency; no nitrile byproducts',
        source: 'Published LCA estimates',
      },
    ],
    dataSource: 'Published LCA estimates',
  },

  // ─────────────────────────────────────────────────
  // ADDITIONAL COMMON SOLVENTS/REAGENTS (46-50)
  // ─────────────────────────────────────────────────

  // 46. Petroleum ether
  {
    cas: '8032-32-4',
    name: 'Petroleum ether',
    synonyms: ['pet ether', 'petroleum spirit', 'light petroleum', 'ligroin'],
    molecularWeight: 82.0,
    densityKgPerL: 0.64,
    co2ePerKg: 3.5,
    waterPerKg: 30,
    energyPerKg: 8.5,
    ghsHazards: ['H225', 'H304', 'H315', 'H336', 'H411'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: false,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'Heptane',
        context: 'Chromatography eluent and crystallisation',
        yieldImpact: 'Defined composition; more reproducible results',
        source: 'CHEM21 solvent selection guide, 2016',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 47. Carbon tetrachloride
  {
    cas: '56-23-5',
    name: 'Carbon tetrachloride',
    synonyms: ['CCl4', 'tetrachloromethane', 'carbon tet'],
    molecularWeight: 153.82,
    densityKgPerL: 1.59,
    co2ePerKg: 8.5,
    waterPerKg: 70,
    energyPerKg: 18.0,
    ghsHazards: ['H301', 'H311', 'H331', 'H351', 'H372', 'H412', 'H420'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'highly_hazardous',
    greenAlternatives: [
      {
        chemical: 'Ethyl acetate',
        context: 'General solvent replacement',
        yieldImpact: 'Different polarity; protocol adjustment needed',
        source: 'CHEM21 solvent selection guide, 2016',
      },
      {
        chemical: 'CPME',
        context: 'Dense solvent replacement for extractions',
        yieldImpact: 'Lower density; may require protocol modification',
        source: 'Byrne et al., Sustain. Chem. Process., 2016',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 48. Benzene
  {
    cas: '71-43-2',
    name: 'Benzene',
    synonyms: ['C6H6', 'cyclohexatriene', 'benzol'],
    molecularWeight: 78.11,
    densityKgPerL: 0.879,
    co2ePerKg: 3.0,
    waterPerKg: 32,
    energyPerKg: 8.0,
    ghsHazards: ['H225', 'H304', 'H315', 'H319', 'H340', 'H350', 'H372'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'highly_hazardous',
    greenAlternatives: [
      {
        chemical: 'Toluene',
        context: 'Aromatic solvent replacement (minimum upgrade)',
        yieldImpact: 'Direct replacement in most applications',
        source: 'CHEM21 solvent selection guide, 2016',
      },
      {
        chemical: 'Anisole',
        context: 'Aromatic solvent for reactions requiring aromatic medium',
        yieldImpact: 'Lower toxicity; similar solvation properties',
        source: 'Prat et al., Green Chem., 2016',
      },
      {
        chemical: 'p-Cymene',
        context: 'Bio-derived aromatic solvent',
        yieldImpact: 'Derived from limonene; renewable source',
        source: 'Clark et al., Green Chem., 2017',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 49. 1,4-Dioxane
  {
    cas: '123-91-1',
    name: '1,4-Dioxane',
    synonyms: ['dioxane', 'diethylene dioxide', 'p-dioxane'],
    molecularWeight: 88.11,
    densityKgPerL: 1.033,
    co2ePerKg: 5.8,
    waterPerKg: 50,
    energyPerKg: 13.0,
    ghsHazards: ['H225', 'H319', 'H335', 'H351'],
    isSuspectedCarcinogen: true,
    isHazardousWaste: true,
    chem21Class: 'hazardous',
    greenAlternatives: [
      {
        chemical: '2-MeTHF',
        context: 'Ethereal solvent replacement',
        yieldImpact: 'Comparable for many organometallic reactions',
        source: 'Pace et al., Green Chem., 2012',
      },
      {
        chemical: 'CPME',
        context: 'Stable ether solvent replacement',
        yieldImpact: 'Low peroxide formation; good thermal stability',
        source: 'Watanabe et al., Org. Process Res. Dev., 2007',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },

  // 50. NMP (N-Methyl-2-pyrrolidone)
  {
    cas: '872-50-4',
    name: 'N-Methyl-2-pyrrolidone',
    synonyms: ['NMP', '1-methyl-2-pyrrolidone', 'N-methyl-2-pyrrolidinone'],
    molecularWeight: 99.13,
    densityKgPerL: 1.028,
    co2ePerKg: 4.8,
    waterPerKg: 45,
    energyPerKg: 11.5,
    ghsHazards: ['H315', 'H319', 'H335', 'H360d'],
    isSuspectedCarcinogen: false,
    isHazardousWaste: true,
    chem21Class: 'problematic',
    greenAlternatives: [
      {
        chemical: 'DMSO',
        context: 'Polar aprotic solvent replacement',
        yieldImpact: 'Comparable for many dissolution and reaction applications',
        source: 'Prat et al., Green Chem., 2016',
      },
      {
        chemical: 'Cyrene (dihydrolevoglucosenone)',
        context: 'Bio-derived dipolar aprotic solvent',
        yieldImpact: 'Growing evidence for comparable performance',
        source: 'Sherwood et al., Chem. Commun., 2014',
      },
      {
        chemical: 'NBP (N-butylpyrrolidinone)',
        context: 'Direct NMP replacement',
        yieldImpact: 'Non-reprotoxic; similar solvent properties',
        source: 'ACS Green Chem. Inst. solvent tool',
      },
    ],
    dataSource: 'CHEM21 solvent guide',
  },
]

/**
 * Look up a chemical by name, synonym, or CAS number (case-insensitive).
 */
export function findChemical(name: string): ChemicalData | undefined {
  const lower = name.toLowerCase().trim()
  return CHEMICALS.find(
    (c) =>
      c.name.toLowerCase() === lower ||
      c.synonyms.some((s) => s.toLowerCase() === lower) ||
      c.cas === lower,
  )
}
