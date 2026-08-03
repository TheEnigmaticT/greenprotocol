/**
 * trace.ts - LLM call and deduplication tracing for cost accounting and forensics
 * 
 * Provides helpers to log:
 * - Per-LLM-call traces (model, tokens, latency, request/response)
 * - Pre/post deduplication state for recommendation transparency
 */

import { createClient as createServerClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Recommendation } from '@/lib/types'

// ─── LLM Call Trace ──────────────────────────────────────────────

export interface LLMCallTrace {
  analysis_id?: string
  analysis_run_id?: string
  user_id: string
  call_label: string
  model: string
  phase: string
  started_at: string
  completed_at: string
  latency_ms: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown>
  stop_reason: string
  success: boolean
  error_message?: string
}

export async function logLLMTrace(trace: LLMCallTrace, supabase?: SupabaseClient): Promise<void> {
  try {
    const client = supabase || await createServerClient()
    
    const { error } = await client.from('gpc_analysis_traces').insert({
      analysis_id: trace.analysis_id || null,
      analysis_run_id: trace.analysis_run_id || null,
      user_id: trace.user_id,
      call_label: trace.call_label,
      model: trace.model,
      phase: trace.phase,
      started_at: trace.started_at,
      completed_at: trace.completed_at,
      latency_ms: trace.latency_ms,
      input_tokens: trace.input_tokens,
      output_tokens: trace.output_tokens,
      total_tokens: trace.total_tokens,
      request_payload: trace.request_payload,
      response_payload: trace.response_payload,
      stop_reason: trace.stop_reason,
      success: trace.success,
      error_message: trace.error_message,
    })

    if (error) {
      console.error('[trace] Failed to log LLM trace:', error)
    } else {
      console.log(
        `[trace] Logged ${trace.call_label} (${trace.latency_ms}ms, ` +
        `${trace.input_tokens}+${trace.output_tokens}=${trace.total_tokens} tokens)`
      )
    }
  } catch (err) {
    // Don't throw — tracing failures shouldn't break the pipeline
    console.error('[trace] Exception logging LLM trace:', err)
  }
}

// ─── Dedup Trace ─────────────────────────────────────────────────

export interface DedupTrace {
  analysis_id?: string
  analysis_run_id?: string
  user_id: string
  raw_recommendations: Recommendation[]
  deduped_recommendations: Recommendation[]
  merge_map: Record<string, number[]>
  dedup_rules?: string
}

export async function logDedupTrace(trace: DedupTrace, supabase?: SupabaseClient): Promise<void> {
  try {
    const client = supabase || await createServerClient()
    
    const { error } = await client.from('gpc_dedup_log').insert({
      analysis_id: trace.analysis_id || null,
      analysis_run_id: trace.analysis_run_id || null,
      user_id: trace.user_id,
      raw_recommendations: trace.raw_recommendations,
      raw_count: trace.raw_recommendations.length,
      deduped_recommendations: trace.deduped_recommendations,
      deduped_count: trace.deduped_recommendations.length,
      merge_map: trace.merge_map,
      dedup_rules: trace.dedup_rules || 'severity+confidence',
    })

    if (error) {
      console.error('[trace] Failed to log dedup trace:', error)
    } else {
      console.log(
        `[trace] Logged dedup: ${trace.raw_recommendations.length} raw → ` +
        `${trace.deduped_recommendations.length} merged`
      )
    }
  } catch (err) {
    // Don't throw — tracing failures shouldn't break the pipeline
    console.error('[trace] Exception logging dedup trace:', err)
  }
}

// ─── Cost Estimation ─────────────────────────────────────────────

/**
 * Rough cost estimation based on Anthropic pricing (as of 2024)
 * Claude 3.5 Sonnet: $3/MTok input, $15/MTok output
 */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  const INPUT_COST_PER_MTOK = 3.0
  const OUTPUT_COST_PER_MTOK = 15.0
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  
  return inputCost + outputCost
}

// ─── Analysis Cost Report ────────────────────────────────────────

export interface CostReport {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  estimated_cost_usd: number
  average_latency_ms: number
  calls_by_phase: Record<string, number>
  tokens_by_phase: Record<string, { input: number; output: number }>
}

/**
 * Fetch cost report for a specific analysis
 */
export async function getAnalysisCostReport(
  analysisId: string,
  supabase?: SupabaseClient
): Promise<CostReport | null> {
  try {
    const client = supabase || await createServerClient()
    
    const { data: traces, error } = await client
      .from('gpc_analysis_traces')
      .select('*')
      .eq('analysis_id', analysisId)
      .order('created_at', { ascending: true })

    if (error || !traces) {
      console.error('[trace] Failed to fetch traces for cost report:', error)
      return null
    }

    const report: CostReport = {
      total_calls: traces.length,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      average_latency_ms: 0,
      calls_by_phase: {},
      tokens_by_phase: {},
    }

    let totalLatency = 0

    for (const trace of traces) {
      report.total_input_tokens += trace.input_tokens
      report.total_output_tokens += trace.output_tokens
      report.total_tokens += trace.total_tokens
      totalLatency += trace.latency_ms

      // Count by phase
      report.calls_by_phase[trace.phase] = (report.calls_by_phase[trace.phase] || 0) + 1
      
      if (!report.tokens_by_phase[trace.phase]) {
        report.tokens_by_phase[trace.phase] = { input: 0, output: 0 }
      }
      report.tokens_by_phase[trace.phase].input += trace.input_tokens
      report.tokens_by_phase[trace.phase].output += trace.output_tokens
    }

    report.average_latency_ms = traces.length > 0 ? Math.round(totalLatency / traces.length) : 0
    report.estimated_cost_usd = estimateCost(report.total_input_tokens, report.total_output_tokens)

    return report
  } catch (err) {
    console.error('[trace] Exception generating cost report:', err)
    return null
  }
}
