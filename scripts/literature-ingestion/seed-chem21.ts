/**
 * Manually seed the CHEM21 solvent selection guide as a high-priority literature source.
 * This is the foundational reference for green solvent selection.
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

const CHEM21_GUIDE = {
  title: 'CHEM21 Selection Guide of Classical- and Less Classical-Solvents',
  authors: 'Prat, D.; Wells, A.; Hayler, J.; Sneddon, H.; McElroy, C. R.; Abou-Shehada, S.; Dunn, P. J.',
  journal: 'Green Chemistry',
  year: 2016,
  doi: '10.1039/c5gc01008j',
  url: 'https://doi.org/10.1039/c5gc01008j',
  abstract: `A solvent selection guide has been developed using traffic light labelling to highlight 
    the environmental, health and safety concerns of solvents commonly used in pharmaceutical manufacturing. 
    The guide has been produced by a consortium of pharmaceutical companies (CHEM21) and includes classical 
    solvents and also covers many less classical solvents which are increasingly being used in the industry. 
    The guide categorises solvents into "recommended", "problematic", and "hazardous" groups based on 
    environmental, health, and safety data. Recommended solvents include water, ethanol, ethyl acetate, 
    2-methyltetrahydrofuran, and dimethyl carbonate. Problematic solvents requiring care include THF, 
    dichloromethane, and toluene. Hazardous solvents to be avoided include benzene, carbon tetrachloride, 
    chloroform, and hexane. The guide provides practical substitution recommendations for common 
    pharmaceutical synthesis scenarios.`,
  content_snippet: `The CHEM21 solvent guide provides a comprehensive traffic-light system for solvent 
    selection in pharmaceutical manufacturing. It recommends water, ethanol, ethyl acetate, acetone, 
    and other low-hazard solvents while flagging DMF, DCM, and hexane as problematic or hazardous.`,
  chemical_subjects: [
    'water', 'ethanol', 'ethyl acetate', 'acetone', '2-methyltetrahydrofuran',
    'dimethyl carbonate', 'THF', 'dichloromethane', 'toluene', 'DMF',
    'benzene', 'carbon tetrachloride', 'chloroform', 'hexane', 'DMSO'
  ],
  principles_addressed: [3, 5, 12], // Less hazardous, safer solvents, accident prevention
  hazard_types: ['solvent_replacement', 'carcinogen', 'reprotoxic', 'volatile_organic'],
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

async function main() {
  console.log('Seeding CHEM21 solvent guide...\n')

  // Check if already exists
  const { data: existing } = await supabase
    .from('literature_precedents')
    .select('id')
    .eq('doi', CHEM21_GUIDE.doi)
    .single()

  if (existing) {
    console.log('CHEM21 guide already exists in database')
    return
  }

  // Generate embedding
  const embeddingText = `${CHEM21_GUIDE.title}\n\n${CHEM21_GUIDE.abstract}`
  const embedding = await generateEmbedding(embeddingText)

  // Insert into database
  const { error } = await supabase
    .from('literature_precedents')
    .insert({
      ...CHEM21_GUIDE,
      embedding,
    })

  if (error) {
    console.error('Error inserting CHEM21 guide:', error.message)
  } else {
    console.log('✓ Successfully seeded CHEM21 solvent selection guide')
    console.log(`  DOI: ${CHEM21_GUIDE.doi}`)
    console.log(`  Chemicals covered: ${CHEM21_GUIDE.chemical_subjects.length}`)
  }
}

main().catch(console.error)
