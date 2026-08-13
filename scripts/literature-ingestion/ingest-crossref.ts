/**
 * Ingest open-access articles from CrossRef API
 * Targets:
 * - Green Chemistry journal (RSC)
 * - ACS Sustainable Chemistry & Engineering
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Service role only: literature tables are RLS-locked (writes revoked from anon).
// The anon key can no longer write here, so never fall back to it.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for literature ingestion')
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

interface CrossRefWork {
  DOI: string
  title: string[]
  author?: Array<{ given?: string; family?: string }>
  'container-title'?: string[]
  published?: { 'date-parts': number[][] }
  abstract?: string
  link?: Array<{ URL: string; 'content-type': string }>
  ISSN?: string[]
}

/**
 * Search CrossRef for articles
 */
async function searchCrossRef(
  query: string,
  issn?: string,
  limit: number = 50
): Promise<CrossRefWork[]> {
  const baseUrl = 'https://api.crossref.org/works'
  const filters = []
  
  if (issn) {
    filters.push(`issn:${issn}`)
  }
  filters.push('type:journal-article')
  // Only get articles with licenses (likely open access)
  filters.push('has-license:true')

  const params = new URLSearchParams({
    query: query,
    filter: filters.join(','),
    rows: limit.toString(),
    mailto: 'contact@greenchemistry.ai', // Polite pool
  })

  const response = await fetch(`${baseUrl}?${params}`)
  if (!response.ok) {
    throw new Error(`CrossRef search failed: ${response.statusText}`)
  }

  const data = await response.json()
  return data.message?.items || []
}

/**
 * Format authors as ACS style
 */
function formatAuthors(authors?: CrossRefWork['author']): string {
  if (!authors || authors.length === 0) return 'Unknown'
  
  const formatted = authors.slice(0, 10).map(author => {
    const family = author.family || ''
    const given = author.given || ''
    return given ? `${family}, ${given.charAt(0)}.` : family
  })
  
  if (authors.length > 10) {
    formatted.push('et al.')
  }
  
  return formatted.join('; ')
}

/**
 * Extract abstract text (CrossRef doesn't always have it)
 */
function extractAbstract(work: CrossRefWork): string {
  if (work.abstract) {
    // Remove XML/HTML tags if present
    return work.abstract.replace(/<[^>]*>/g, '').trim()
  }
  return ''
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
 * Extract chemical subjects from title/abstract
 */
function extractChemicalSubjects(text: string): string[] {
  const chemicals = new Set<string>()
  
  const patterns = [
    /\b(DMF|DMSO|THF|acetonitrile|methanol|ethanol|water|toluene|benzene)\b/gi,
    /\b(dichloromethane|chloroform|hexane|acetone|ethyl acetate)\b/gi,
    /\b([A-Z][a-z]+ [a-z]+ate)\b/g, // e.g., "ethyl acetate"
  ]
  
  for (const pattern of patterns) {
    const matches = text.match(pattern)
    if (matches) {
      matches.forEach(m => chemicals.add(m.toLowerCase()))
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
  
  const principleKeywords = [
    { num: 1, keywords: ['waste', 'prevention', 'atom economy'] },
    { num: 3, keywords: ['toxic', 'hazard', 'safer', 'benign'] },
    { num: 5, keywords: ['solvent', 'auxiliary', 'green solvent'] },
    { num: 6, keywords: ['energy', 'efficiency', 'ambient'] },
    { num: 7, keywords: ['renewable', 'biomass', 'feedstock'] },
    { num: 9, keywords: ['catalyst', 'catalytic'] },
    { num: 10, keywords: ['degradation', 'biodegradable'] },
    { num: 12, keywords: ['accident', 'safer chemistry', 'inherent'] },
  ]
  
  for (const { num, keywords } of principleKeywords) {
    if (keywords.some(kw => lowerText.includes(kw))) {
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
  
  const hazardPatterns = [
    { type: 'carcinogen', keywords: ['carcinogen', 'cancer', 'mutagenic'] },
    { type: 'reprotoxic', keywords: ['reproductive', 'reprotoxic', 'teratogen'] },
    { type: 'solvent_replacement', keywords: ['solvent replacement', 'alternative solvent', 'green solvent'] },
    { type: 'volatile_organic', keywords: ['VOC', 'volatile organic'] },
    { type: 'persistent', keywords: ['persistent', 'bioaccumulative', 'PBT'] },
  ]
  
  for (const { type, keywords } of hazardPatterns) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      hazards.add(type)
    }
  }
  
  return Array.from(hazards)
}

/**
 * Ingest a single work into the database
 */
async function ingestWork(work: CrossRefWork): Promise<void> {
  if (!work.DOI || !work.title?.[0]) {
    console.log(`Skipping: missing DOI or title`)
    return
  }

  // Check if already exists
  const { data: existing } = await supabase
    .from('literature_precedents')
    .select('id')
    .eq('doi', work.DOI)
    .single()

  if (existing) {
    console.log(`Skipping ${work.DOI}: already exists`)
    return
  }

  const title = work.title[0]
  const authors = formatAuthors(work.author)
  const journal = work['container-title']?.[0] || 'Unknown'
  const year = work.published?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
  const abstract = extractAbstract(work)
  
  if (!abstract) {
    console.log(`Skipping ${work.DOI}: no abstract available`)
    return
  }

  // Generate embedding
  const embeddingText = `${title}\n\n${abstract}`
  const embedding = await generateEmbedding(embeddingText)

  // Extract metadata
  const chemicalSubjects = extractChemicalSubjects(embeddingText)
  const principlesAddressed = inferPrinciples(embeddingText)
  const hazardTypes = inferHazardTypes(embeddingText)

  // Insert into database
  const { error } = await supabase
    .from('literature_precedents')
    .insert({
      title,
      authors,
      journal,
      year,
      doi: work.DOI,
      url: `https://doi.org/${work.DOI}`,
      abstract,
      content_snippet: abstract.substring(0, 500),
      embedding,
      chemical_subjects: chemicalSubjects,
      principles_addressed: principlesAddressed,
      hazard_types: hazardTypes,
    })

  if (error) {
    console.error(`Error inserting ${work.DOI}:`, error.message)
  } else {
    console.log(`✓ Ingested: ${title} (${work.DOI})`)
  }
}

/**
 * Main ingestion function
 */
async function main() {
  console.log('Starting CrossRef ingestion...\n')

  const sources = [
    {
      name: 'Green Chemistry (RSC)',
      issn: '1463-9270',
      queries: ['solvent substitution', 'hazard reduction', 'green synthesis'],
    },
    {
      name: 'ACS Sustainable Chemistry & Engineering',
      issn: '2168-0485',
      queries: ['alternative solvents', 'safer chemistry', 'renewable feedstocks'],
    },
  ]

  for (const source of sources) {
    console.log(`\n=== ${source.name} ===\n`)
    
    for (const query of source.queries) {
      console.log(`Searching: "${query}"`)
      try {
        const works = await searchCrossRef(query, source.issn, 20)
        console.log(`Found ${works.length} articles\n`)

        for (const work of works) {
          try {
            await ingestWork(work)
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500))
          } catch (error) {
            console.error(`Error processing work:`, error)
          }
        }
      } catch (error) {
        console.error(`Error searching CrossRef:`, error)
      }
    }
  }

  console.log('\n✅ CrossRef ingestion complete')
}

main().catch(console.error)
