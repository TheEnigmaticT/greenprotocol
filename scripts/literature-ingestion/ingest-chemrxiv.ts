/**
 * Ingest green chemistry preprints from ChemRxiv.
 * ChemRxiv is built on Figshare, so we use the Figshare API.
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

interface ChemRxivArticle {
  id: number
  title: string
  description: string
  doi: string
  url: string
  published_date: string
  authors: Array<{
    full_name: string
  }>
  tags: string[]
}

/**
 * Search ChemRxiv via Figshare API
 */
async function searchChemRxiv(query: string, limit: number = 50): Promise<ChemRxivArticle[]> {
  const baseUrl = 'https://api.figshare.com/v2/articles/search'
  
  const requestBody = {
    search_for: `:title: ${query} OR :description: ${query}`,
    item_type: 3, // preprint
    page_size: limit,
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`ChemRxiv search failed: ${response.statusText}`)
  }

  const articles = await response.json()
  
  // Filter for ChemRxiv specifically (domain: chemrxiv.org)
  return articles.filter((a: ChemRxivArticle) => 
    a.url && a.url.includes('chemrxiv')
  )
}

/**
 * Format authors
 */
function formatAuthors(authors: ChemRxivArticle['authors']): string {
  if (!authors || authors.length === 0) return 'Unknown'
  
  const formatted = authors.slice(0, 10).map(author => author.full_name)
  
  if (authors.length > 10) {
    formatted.push('et al.')
  }
  
  return formatted.join('; ')
}

/**
 * Generate embedding
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

/**
 * Extract chemical subjects
 */
function extractChemicalSubjects(text: string, tags: string[]): string[] {
  const chemicals = new Set<string>()
  
  // Check tags first
  const chemicalTags = tags.filter(tag => 
    tag.toLowerCase().includes('solvent') ||
    tag.toLowerCase().includes('catalyst') ||
    /^[A-Z][a-z]?\d*$/.test(tag) // Chemical formulas
  )
  chemicals.add(...chemicalTags)
  
  // Extract from text
  const solvents = [
    'DMF', 'DMSO', 'acetonitrile', 'methanol', 'ethanol', 'water',
    'dichloromethane', 'chloroform', 'toluene', 'benzene', 'hexane',
    'ethyl acetate', 'THF', 'tetrahydrofuran', 'acetone'
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
 * Infer principles
 */
function inferPrinciples(text: string, tags: string[]): number[] {
  const principles: number[] = []
  const searchText = (text + ' ' + tags.join(' ')).toLowerCase()
  
  const principleKeywords = [
    { num: 1, keywords: ['waste', 'prevention', 'atom economy'] },
    { num: 3, keywords: ['toxic', 'hazard', 'safer'] },
    { num: 5, keywords: ['solvent', 'green solvent'] },
    { num: 6, keywords: ['energy', 'efficiency'] },
    { num: 7, keywords: ['renewable', 'biomass'] },
    { num: 9, keywords: ['catalyst', 'catalytic'] },
    { num: 10, keywords: ['degradation', 'biodegradable'] },
  ]
  
  for (const { num, keywords } of principleKeywords) {
    if (keywords.some(kw => searchText.includes(kw))) {
      principles.push(num)
    }
  }
  
  return principles
}

/**
 * Infer hazard types
 */
function inferHazardTypes(text: string): string[] {
  const hazards = new Set<string>()
  const lowerText = text.toLowerCase()
  
  if (lowerText.includes('carcinogen') || lowerText.includes('cancer')) {
    hazards.add('carcinogen')
  }
  if (lowerText.includes('solvent replacement') || lowerText.includes('alternative solvent')) {
    hazards.add('solvent_replacement')
  }
  if (lowerText.includes('VOC') || lowerText.includes('volatile organic')) {
    hazards.add('volatile_organic')
  }
  
  return Array.from(hazards)
}

/**
 * Ingest a single article
 */
async function ingestArticle(article: ChemRxivArticle): Promise<void> {
  if (!article.doi || !article.description) {
    console.log(`Skipping: missing DOI or description`)
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

  const title = article.title
  const authors = formatAuthors(article.authors)
  const abstract = article.description
  const year = new Date(article.published_date).getFullYear()

  // Generate embedding
  const embeddingText = `${title}\n\n${abstract}`
  const embedding = await generateEmbedding(embeddingText)

  // Extract metadata
  const chemicalSubjects = extractChemicalSubjects(embeddingText, article.tags)
  const principlesAddressed = inferPrinciples(embeddingText, article.tags)
  const hazardTypes = inferHazardTypes(embeddingText)

  // Insert into database
  const { error } = await supabase
    .from('literature_precedents')
    .insert({
      title,
      authors,
      journal: 'ChemRxiv (preprint)',
      year,
      doi: article.doi,
      url: article.url,
      abstract,
      content_snippet: abstract.substring(0, 500),
      embedding,
      chemical_subjects: chemicalSubjects,
      principles_addressed: principlesAddressed,
      hazard_types: hazardTypes,
    })

  if (error) {
    console.error(`Error inserting ${article.doi}:`, error.message)
  } else {
    console.log(`✓ Ingested: ${title} (${article.doi})`)
  }
}

/**
 * Main ingestion function
 */
async function main() {
  console.log('Starting ChemRxiv ingestion...\n')

  const queries = [
    'green chemistry',
    'sustainable synthesis',
    'solvent replacement',
    'alternative solvents',
  ]

  for (const query of queries) {
    console.log(`\nSearching ChemRxiv: "${query}"`)
    try {
      const articles = await searchChemRxiv(query, 20)
      console.log(`Found ${articles.length} preprints\n`)

      for (const article of articles) {
        try {
          await ingestArticle(article)
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`Error processing article:`, error)
        }
      }
    } catch (error) {
      console.error(`Error searching ChemRxiv:`, error)
    }
  }

  console.log('\n✅ ChemRxiv ingestion complete')
}

main().catch(console.error)
