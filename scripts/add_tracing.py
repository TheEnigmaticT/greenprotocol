#!/usr/bin/env python3
"""
Script to add tracing calls to pipeline.ts
Handles the remaining function signature updates and dedup logic
"""

import re

def update_pipeline_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # 1. Update parseProtocol signature (if not already done)
    content = re.sub(
        r'async function parseProtocol\(protocolText: string\): Promise<ParseResult>',
        'async function parseProtocol(protocolText: string, context?: CallContext): Promise<ParseResult>',
        content
    )
    
    # 2. Update parseProtocol callClaude call
    content = re.sub(
        r"const result = await callClaude<ParseResult>\(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, 'parse'\)",
        "const result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, 'parse', SONNET, context)",
        content
    )
    
    # 3. Update evaluatePrinciple signature
    content = re.sub(
        r'async function evaluatePrinciple\(\s*principleNumber: number,\s*steps: AnalysisStep\[\]\s*\): Promise<PrincipleResult>',
        '''async function evaluatePrinciple(
  principleNumber: number,
  steps: AnalysisStep[],
  context?: CallContext
): Promise<PrincipleResult>''',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 4. Update evaluatePrinciple callClaude call
    content = re.sub(
        r"return callClaude<PrincipleResult>\(systemPrompt, `Analyze these protocol steps against Principle \$\{principleNumber\}:\\\\n\\\\n\$\{stepsJson\}`, PRINCIPLE_SCHEMA, `principle-\$\{principleNumber\}`\)",
        r"return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle ${principleNumber}:\\n\\n${stepsJson}`, PRINCIPLE_SCHEMA, `principle-${principleNumber}`, SONNET, context)",
        content
    )
    
    # 5. Update evaluateAllPrinciples signature
    content = re.sub(
        r'async function evaluateAllPrinciples\(\s*steps: AnalysisStep\[\],\s*onProgress\?: \(event: ProgressEvent\) => void\s*\): Promise<Recommendation\[\]>',
        '''async function evaluateAllPrinciples(
  steps: AnalysisStep[],
  onProgress?: (event: ProgressEvent) => void,
  context?: CallContext
): Promise<Recommendation[]>''',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 6. Update evaluateAllPrinciples batch map call
    content = re.sub(
        r'batch\.map\(p => evaluatePrinciple\(p\.number, steps\)\)',
        'batch.map(p => evaluatePrinciple(p.number, steps, context))',
        content
    )
    
    # 7. Update assembleResult signature
    content = re.sub(
        r'async function assembleResult\(\s*protocolText: string,\s*steps: AnalysisStep\[\],\s*recommendations: Recommendation\[\]\s*\): Promise<AssembleResult>',
        '''async function assembleResult(
  protocolText: string,
  steps: AnalysisStep[],
  recommendations: Recommendation[],
  context?: CallContext
): Promise<AssembleResult>''',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 8. Update assembleResult callClaude call
    content = re.sub(
        r"const result = await callClaude<AssembleResult>\(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above\.', ASSEMBLE_SCHEMA, 'assemble'\)",
        "const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble', SONNET, context)",
        content
    )
    
    # 9. Update deduplicateRecommendations signature and return
    content = re.sub(
        r'function deduplicateRecommendations\(recs: Recommendation\[\]\): Recommendation\[\] \{',
        '''function deduplicateRecommendations(
  recs: Recommendation[],
  context?: CallContext
): { deduped: Recommendation[]; mergeMap: Record<string, number[]> } {''',
        content
    )
    
    # 10. Add mergeMap tracking at start of dedup function
    content = re.sub(
        r'(function deduplicateRecommendations\([^}]+\) \{\s*const map = new Map<string, MergeSlot>\(\))',
        r'\1\n  const mergeMap: Record<string, number[]> = {}',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 11. Update dedup loop to track indices
    content = re.sub(
        r'  for \(const rec of recs\) \{',
        '  for (let i = 0; i < recs.length; i++) {\n    const rec = recs[i]',
        content
    )
    
    # 12. Add mergeMap initialization when creating new entry
    content = re.sub(
        r'(map\.set\(key, \{ best: \{ \.\.\.rec \}, issuesByPrinciple, alternativesByChemical \}\))\s*continue',
        r'\1\n      mergeMap[key] = [i]\n      continue',
        content
    )
    
    # 13. Add mergeMap tracking when merging
    # Find the merge section and add tracking
    content = re.sub(
        r'(const existing = map\.get\(key\)\s+if \(!existing\) \{[^}]+continue\s+\})',
        r'\1\n\n    // Track which raw recommendations merged into this key\n    mergeMap[key].push(i)',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 14. Update dedup return statement
    content = re.sub(
        r'  // Sort by step number, then severity \(high first\)\s*return results\.sort\(\(a, b\) =>\s*a\.stepNumber - b\.stepNumber \|\| SEVERITY_ORDER\[b\.severity\] - SEVERITY_ORDER\[a\.severity\]\s*\)\s*\}',
        '''  // Sort by step number, then severity (high first)
  const deduped = results.sort((a, b) =>
    a.stepNumber - b.stepNumber || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  )

  // Log dedup trace if context provided
  if (context?.userId) {
    void logDedupTrace({
      analysis_id: context.analysisId,
      user_id: context.userId,
      raw_recommendations: recs,
      deduped_recommendations: deduped,
      merge_map: mergeMap,
      dedup_rules: 'severity+confidence',
    }, context.supabase)
  }

  return { deduped, mergeMap }
}''',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 15. Update analyzeProtocol signature
    content = re.sub(
        r'export async function analyzeProtocol\(\s*protocolText: string,\s*onProgress\?: \(event: ProgressEvent\) => void\s*\): Promise<AnalysisResult>',
        '''export async function analyzeProtocol(
  protocolText: string,
  onProgress?: (event: ProgressEvent) => void,
  context?: CallContext
): Promise<AnalysisResult>''',
        content,
        flags=re.MULTILINE | re.DOTALL
    )
    
    # 16. Update analyzeProtocol internal calls
    content = re.sub(
        r'const parsed = await parseProtocol\(protocolText\)',
        'const parsed = await parseProtocol(protocolText, context)',
        content
    )
    
    content = re.sub(
        r'const rawRecommendations = await evaluateAllPrinciples\(parsed\.steps, onProgress\)',
        'const rawRecommendations = await evaluateAllPrinciples(parsed.steps, onProgress, context)',
        content
    )
    
    # 17. Update dedup call and usage
    content = re.sub(
        r'  const recommendations = deduplicateRecommendations\(rawRecommendations\)\s*console\.log\(`Deduplication: \$\{rawRecommendations\.length\} raw → \$\{recommendations\.length\} merged`\)',
        r'  const { deduped: recommendations } = deduplicateRecommendations(rawRecommendations, context)\n  console.log(`Deduplication: ${rawRecommendations.length} raw → ${recommendations.length} merged`)',
        content
    )
    
    content = re.sub(
        r'const assembled = await assembleResult\(protocolText, parsed\.steps, recommendations\)',
        'const assembled = await assembleResult(protocolText, parsed.steps, recommendations, context)',
        content
    )
    
    # Write the updated content
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"Successfully updated {filepath}")

if __name__ == '__main__':
    update_pipeline_file('lib/pipeline.ts')
