/**
 * Benchmark script for v0.7 two-pass re-evaluation pipeline
 * 
 * Measures:
 * - Latency per recommendation
 * - Total analysis time with/without re-evaluation
 * - Token consumption
 * - Suppression rate
 * - Cost per analysis
 * 
 * Usage:
 *   npx tsx scripts/benchmark-reevaluation.ts [protocol-file]
 */

import { analyzeProtocol } from '@/lib/pipeline'
import type { ProgressEvent } from '@/lib/types'
import { readFileSync } from 'fs'

interface BenchmarkMetrics {
  protocolName: string
  totalTime: number
  phase1Time: number
  phase2Time: number
  phase2_7Time: number
  phase3Time: number
  totalRecommendations: number
  confirmedCount: number
  downgradedCount: number
  suppressedCount: number
  failedCount: number
  avgLatencyPerRec: number
  estimatedTokens: {
    input: number
    output: number
    cost: number
  }
  suppressionRate: number
}

function estimateTokens(recommendationCount: number): { input: number; output: number; cost: number } {
  // Rough estimates based on typical re-evaluation calls
  const inputTokensPerRec = 2000  // System prompt + recommendation + literature snippets
  const outputTokensPerRec = 400  // Re-evaluation result JSON
  
  const input = recommendationCount * inputTokensPerRec
  const output = recommendationCount * outputTokensPerRec
  
  // Claude Sonnet 4.5 pricing: $3/M input, $15/M output
  const costInput = (input / 1_000_000) * 3
  const costOutput = (output / 1_000_000) * 15
  const cost = costInput + costOutput
  
  return { input, output, cost }
}

async function benchmarkAnalysis(protocolText: string, protocolName: string): Promise<BenchmarkMetrics> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Benchmarking: ${protocolName}`)
  console.log('='.repeat(60))
  
  const phaseTimings: Record<string, number> = {}
  let currentPhase = ''
  let phaseStart = 0
  
  const onProgress = (event: ProgressEvent) => {
    if (event.type === 'phase') {
      if (currentPhase) {
        phaseTimings[currentPhase] = Date.now() - phaseStart
      }
      
      if (event.message?.includes('Re-evaluating')) {
        currentPhase = 'phase2.7'
        phaseStart = Date.now()
      } else if (event.phase === 1) {
        currentPhase = 'phase1'
        phaseStart = Date.now()
      } else if (event.phase === 2) {
        if (!currentPhase.startsWith('phase2')) {
          currentPhase = 'phase2'
          phaseStart = Date.now()
        }
      } else if (event.phase === 3) {
        currentPhase = 'phase3'
        phaseStart = Date.now()
      }
    }
  }
  
  const startTime = Date.now()
  const result = await analyzeProtocol(protocolText, onProgress)
  const totalTime = Date.now() - startTime
  
  if (currentPhase) {
    phaseTimings[currentPhase] = Date.now() - phaseStart
  }
  
  const stats = result.reevaluationStats || { confirmed: 0, downgraded: 0, suppressed: 0, failed: 0 }
  const totalRecommendations = result.recommendations.length + stats.suppressed
  const avgLatencyPerRec = phaseTimings['phase2.7'] ? phaseTimings['phase2.7'] / totalRecommendations : 0
  const suppressionRate = totalRecommendations > 0 ? (stats.suppressed / totalRecommendations) * 100 : 0
  
  // Estimate tokens for all recommendations (including suppressed ones)
  const tokenEstimate = estimateTokens(totalRecommendations)
  
  const metrics: BenchmarkMetrics = {
    protocolName,
    totalTime,
    phase1Time: phaseTimings['phase1'] || 0,
    phase2Time: phaseTimings['phase2'] || 0,
    phase2_7Time: phaseTimings['phase2.7'] || 0,
    phase3Time: phaseTimings['phase3'] || 0,
    totalRecommendations,
    confirmedCount: stats.confirmed,
    downgradedCount: stats.downgraded,
    suppressedCount: stats.suppressed,
    failedCount: stats.failed,
    avgLatencyPerRec,
    estimatedTokens: tokenEstimate,
    suppressionRate,
  }
  
  return metrics
}

function printMetrics(metrics: BenchmarkMetrics) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log('BENCHMARK RESULTS')
  console.log('─'.repeat(60))
  
  console.log(`\n⏱️  Timing`)
  console.log(`   Total analysis time:        ${(metrics.totalTime / 1000).toFixed(1)}s`)
  console.log(`   Phase 1 (Parse):            ${(metrics.phase1Time / 1000).toFixed(1)}s`)
  console.log(`   Phase 2 (Evaluate):         ${(metrics.phase2Time / 1000).toFixed(1)}s`)
  console.log(`   Phase 2.7 (Re-evaluate):    ${(metrics.phase2_7Time / 1000).toFixed(1)}s`)
  console.log(`   Phase 3 (Assemble):         ${(metrics.phase3Time / 1000).toFixed(1)}s`)
  console.log(`   Avg per recommendation:     ${(metrics.avgLatencyPerRec / 1000).toFixed(1)}s`)
  
  console.log(`\n📊 Recommendations`)
  console.log(`   Total generated:            ${metrics.totalRecommendations}`)
  console.log(`   Confirmed:                  ${metrics.confirmedCount} (${((metrics.confirmedCount / metrics.totalRecommendations) * 100).toFixed(1)}%)`)
  console.log(`   Downgraded:                 ${metrics.downgradedCount} (${((metrics.downgradedCount / metrics.totalRecommendations) * 100).toFixed(1)}%)`)
  console.log(`   Suppressed:                 ${metrics.suppressedCount} (${metrics.suppressionRate.toFixed(1)}%)`)
  console.log(`   Failed re-evaluation:       ${metrics.failedCount}`)
  
  console.log(`\n💰 Cost Estimate`)
  console.log(`   Input tokens:               ${metrics.estimatedTokens.input.toLocaleString()}`)
  console.log(`   Output tokens:              ${metrics.estimatedTokens.output.toLocaleString()}`)
  console.log(`   Estimated cost:             $${metrics.estimatedTokens.cost.toFixed(4)}`)
  console.log(`   Cost per recommendation:    $${(metrics.estimatedTokens.cost / metrics.totalRecommendations).toFixed(4)}`)
  
  console.log(`\n📈 Performance`)
  const reevOverhead = metrics.phase2_7Time / metrics.totalTime * 100
  console.log(`   Re-evaluation overhead:     ${reevOverhead.toFixed(1)}% of total time`)
  console.log(`   Suppression rate:           ${metrics.suppressionRate.toFixed(1)}%`)
  
  console.log(`\n${'─'.repeat(60)}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/benchmark-reevaluation.ts <protocol-file>')
    console.error('Example: npx tsx scripts/benchmark-reevaluation.ts tests/fixtures/sample-protocol.txt')
    process.exit(1)
  }
  
  const protocolFile = args[0]
  let protocolText: string
  
  try {
    protocolText = readFileSync(protocolFile, 'utf-8')
  } catch (err) {
    console.error(`Failed to read protocol file: ${protocolFile}`)
    console.error(err)
    process.exit(1)
  }
  
  try {
    const metrics = await benchmarkAnalysis(protocolText, protocolFile)
    printMetrics(metrics)
    
    // Exit with non-zero if metrics exceed thresholds
    if (metrics.avgLatencyPerRec > 7000) {
      console.error('⚠️  ALERT: Avg latency per recommendation exceeds 7s threshold')
      process.exit(1)
    }
    if (metrics.suppressionRate > 40) {
      console.error('⚠️  ALERT: Suppression rate exceeds 40% threshold')
      process.exit(1)
    }
    if (metrics.estimatedTokens.cost > 0.50) {
      console.error('⚠️  ALERT: Estimated cost per analysis exceeds $0.50 threshold')
      process.exit(1)
    }
    
    console.log('✅ All performance thresholds met')
  } catch (err) {
    console.error('Benchmark failed:', err)
    process.exit(1)
  }
}

main()
