import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface SearchResult {
  id: string
  title: string
  authors?: string
  journal?: string
  year?: number
  doi?: string
  url?: string
  content_snippet?: string
  similarity: number
}

export async function searchLiterature(params: {
  query: string
  limit: number
  threshold: number
  principles?: number[]
  chemicals?: string[]
}): Promise<SearchResult[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: params.query,
  })
  const embedding = embeddingResponse.data[0].embedding

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('match_literature_precedents', {
    query_embedding: embedding,
    match_threshold: params.threshold,
    match_count: params.limit,
    filter_principles: params.principles ?? [],
    filter_chemicals: params.chemicals ?? [],
  })

  if (error) throw error
  return (data ?? []) as SearchResult[]
}
