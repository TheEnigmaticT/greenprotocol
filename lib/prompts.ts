// Phase-specific prompts are now in lib/prompts/parse.ts, lib/prompts/principles.ts, and lib/prompts/assemble.ts

export const EXAMPLE_PROTOCOLS = {
  organicExtraction: `Organic Extraction and Purification

Step 1: Dissolve 5g of crude product in 50 mL dichloromethane (DCM).
Step 2: Transfer to a separatory funnel and wash with 3 × 30 mL saturated sodium bicarbonate solution.
Step 3: Wash organic layer with 2 × 30 mL brine.
Step 4: Dry organic layer over anhydrous sodium sulfate (15g).
Step 5: Filter and concentrate under reduced pressure on a rotary evaporator at 40°C.
Step 6: Purify by column chromatography using hexane/ethyl acetate (4:1) as eluent (approximately 500 mL total solvent).
Step 7: Concentrate pure fractions to yield product as white solid.`,

  suzukiCoupling: `Suzuki-Miyaura Cross-Coupling Reaction

Step 1: To a 250 mL round-bottom flask under nitrogen atmosphere, add 4-bromoanisole (1.87g, 10 mmol), phenylboronic acid (1.34g, 11 mmol), and Pd(PPh3)4 (0.58g, 0.5 mmol, 5 mol%) in 100 mL of DMF.
Step 2: Add potassium carbonate (4.15g, 30 mmol) dissolved in 20 mL water.
Step 3: Heat the mixture to 80°C and stir for 12 hours under nitrogen.
Step 4: Cool to room temperature and dilute with 200 mL diethyl ether.
Step 5: Wash with 3 × 100 mL water, then 1 × 100 mL brine.
Step 6: Dry over magnesium sulfate, filter, and concentrate.
Step 7: Purify by column chromatography (hexane/ethyl acetate 9:1) to yield 4-methoxybiphenyl.`,

  acidBaseTitration: `Acid-Base Titration of Unknown Acid

Step 1: Weigh approximately 0.5g of unknown acid sample on analytical balance.
Step 2: Dissolve in 50 mL deionized water in a 250 mL Erlenmeyer flask.
Step 3: Add 3 drops of phenolphthalein indicator (1% solution in ethanol).
Step 4: Fill burette with standardized 0.1 M NaOH solution.
Step 5: Titrate slowly with stirring until persistent pink endpoint (approximately 30 seconds).
Step 6: Record volume of NaOH used. Repeat two more times for triplicate data.
Step 7: Calculate molar mass of unknown acid from average titre volume.`,
}
