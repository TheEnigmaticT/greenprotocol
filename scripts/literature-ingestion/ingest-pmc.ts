/**
 * Ingest open-access articles from PubMed Central (PMC) for green chemistry topics.
 * 
 * Search strategy:
 * - Query PMC for "green chemistry" OR "sustainable chemistry" OR "solvent replacement"
 * - Filter for open-access articles only
 * - Extract DOI, title, authors, abstract, publication year
 * - Generate embeddings and store in literature_precedents table
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

interface PMCArticle {
  pmcid: string
  pmid: string
  doi: string
  title: string
  authorString: string
  journalTitle: string
  pubYear: string
  abstractText: string
}

/**
 * Search PubMed Central for green chemistry articles
 */
async function searchPMC(query: string, limit: number = 50): Promise<PMCArticle[]> {
  const baseUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
  const params = new URLSearchParams({
    query: query,
    format: 'json',
    pageSize: limit.toString(),
    resultType: 'core',
  })

  const response = await fetch(`${baseUrl}?${params}`)
  if (!response.ok) {
    throw new Error(`PMC search failed: ${response.statusText}`)
  }

  const data = await response.json()
  return data.resultList?.result || []
}

/**
 * Generate embedding for text content
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

/**
 * Extract chemical subjects from abstract (simple keyword matching for now)
 */
function extractChemicalSubjects(text: string): string[] {
  const chemicals = new Set<string>()
  
  // Common solvent patterns
  const solvents = [
    'DMF', 'DMSO', 'acetonitrile', 'methanol', 'ethanol', 'water',
    'dichloromethane', 'chloroform', 'toluene', 'benzene', 'hexane',
    'ethyl acetate', 'THF', 'tetrahydrofuran', 'acetone', 'diethyl ether'
  ]
  
  const lowerText = text.toLowerCase()
  for (const solvent of solvents) {
    if (lowerText.includes(solvent.toLowerCase())) {
      chemicals.add(solvent)
    }
  }
  
  return Array.from(chemicals)
}

/**
 * Infer which green chemistry principles are addressed
 */
function inferPrinciples(text: string): number[] {
  const principles: number[] = []
  const lowerText = text.toLowerCase()
  
  // Principle 1: Prevention (waste)
  if (lowerText.includes('waste') || lowerText.includes('prevention')) {
    principles.push(1)
  }
  
  // Principle 3: Less Hazardous Chemical Syntheses
  if (lowerText.includes('toxic') || lowerText.includes('hazard') || lowerText.includes('safer')) {
    principles.push(3)
  }
  
  // Principle 5: Safer Solvents and Auxiliaries
  if (lowerText.includes('solvent') || lowerText.includes('green solvent')) {
    principles.push(5)
  }
  
  // Principle 6: Design for Energy Efficiency
  if (lowerText.includes('energy') || lowerText.includes('temperature')) {
    principles.push(6)
  }
  
  // Principle 7: Use of Renewable Feedstocks
  if (lowerText.includes('renewable') || lowerText.includes('biomass')) {
    principles.push(7)
  }
  
  // Principle 10: Design for Degradation
  if (lowerText.includes('biodegradable') || lowerText.includes('degradation')) {
    principles.push(10)
  }
  
  return principles
}

/**
 * Infer hazard types from abstract
 */
function inferHazardTypes(text: string): string[] {
  const hazards = new Set<string>()
  const lowerText = text.toLowerCase()
  
  if (lowerText.includes('carcinogen') || lowerText.includes('cancer')) {
    hazards.add('carcinogen')
  }
  if (lowerText.includes('reproductive') || lowerText.includes('reprotoxic')) {
    hazards.add('reprotoxic')
  }
  if (lowerText.includes('solvent replacement') || lowerText.includes('alternative solvent')) {
    hazards.add('solvent_replacement')
  }
  if (lowerText.includes('volatile organic') || lowerText.includes('VOC')) {
    hazards.add('volatile_organic')
  }
  
  return Array.from(hazards)
}

/**
 * Ingest a single article into the database
 */
async function ingestArticle(article: PMCArticle): Promise<void> {
  if (!article.doi || !article.abstractText) {
    console.log(`Skipping ${article.pmcid}: missing DOI or abstract`)
    return
  }

  // Check if already exists
  const { data: existing } = await supabase
    .from('literature_precedents')
    .select('id')
    .eq('doi', article.doi)
    .single()

  if (existing) {
    console.log(`Skipping ${article.doi}: already exists`)
    return
  }

  // Generate embedding
  const embeddingText = `${article.title}\n\n${article.abstractText}`
  const embedding = await generateEmbedding(embeddingText)

  // Extract metadata
  const chemicalSubjects = extractChemicalSubjects(article.abstractText)
  const principlesAddressed = inferPrinciples(article.abstractText)
  const hazardTypes = inferHazardTypes(article.abstractText)

  // Insert into database
  const { error } = await supabase
    .from('literature_precedents')
    .insert({
      title: article.title,
      authors: article.authorString,
      journal: article.journalTitle,
      year: parseInt(article.pubYear),
      doi: article.doi,
      url: `https://doi.org/${article.doi}`,
      abstract: article.abstractText,
      content_snippet: article.abstractText.substring(0, 500),
      embedding: embedding,
      chemical_subjects: chemicalSubjects,
      principles_addressed: principlesAddressed,
      hazard_types: hazardTypes,
    })

  if (error) {
    console.error(`Error inserting ${article.doi}:`, error.message)
  } else {
    console.log(`✓ Ingested: ${article.title} (${article.doi})`)
  }
}

/**
 * Main ingestion function
 */
async function main() {
  console.log('Starting PMC ingestion...\n')

  const queries = [
    'green chemistry AND solvent',
    'sustainable chemistry AND hazard reduction',
    'alternative solvents AND organic synthesis',
  ]

  for (const query of queries) {
    console.log(`\nSearching PMC: "${query}"`)
    const articles = await searchPMC(query, 20)
    console.log(`Found ${articles.length} articles\n`)

    for (const article of articles) {
      try {
        await ingestArticle(article)
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`Error processing article:`, error)
      }
    }
  }

  console.log('\n✅ PMC ingestion complete')
}

main().catch(console.error)
