#!/bin/bash
# Script to update pipeline.ts function signatures for tracing support

FILE="lib/pipeline.ts"

# Backup the file
cp "$FILE" "$FILE.backup"

echo "Updating function signatures and calls for tracing..."

# Update parseProtocol signature
sed -i '' 's/async function parseProtocol(protocolText: string): Promise<ParseResult> {/async function parseProtocol(protocolText: string, context?: CallContext): Promise<ParseResult> {/g' "$FILE"

# Update parseProtocol call to callClaude
sed -i '' 's/const result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, '\''parse'\'')/const result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, '\''parse'\'', SONNET, context)/g' "$FILE"

# Update evaluatePrinciple signature
sed -i '' 's/async function evaluatePrinciple(/async function evaluatePrinciple(/g' "$FILE"
sed -i '' 's/  principleNumber: number,$/  principleNumber: number,/g' "$FILE"
sed -i '' 's/  steps: AnalysisStep[]$/  steps: AnalysisStep[],\n  context?: CallContext/g' "$FILE"

# Update evaluatePrinciple return call
sed -i '' 's/return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle \${principleNumber}:\\n\\n\${stepsJson}`, PRINCIPLE_SCHEMA, `principle-\${principleNumber}`)/return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle \${principleNumber}:\\n\\n\${stepsJson}`, PRINCIPLE_SCHEMA, `principle-\${principleNumber}`, SONNET, context)/g' "$FILE"

# Update evaluateAllPrinciples signature
sed -i '' 's/async function evaluateAllPrinciples(/async function evaluateAllPrinciples(/g' "$FILE"
sed -i '' 's/  onProgress?: (event: ProgressEvent) => void$/  onProgress?: (event: ProgressEvent) => void,\n  context?: CallContext/g' "$FILE"

# Update evaluateAllPrinciples batch map call
sed -i '' 's/batch.map(p => evaluatePrinciple(p.number, steps))/batch.map(p => evaluatePrinciple(p.number, steps, context))/g' "$FILE"

# Update assembleResult signature
sed -i '' 's/async function assembleResult(/async function assembleResult(/g' "$FILE"
sed -i '' 's/  recommendations: Recommendation\[\]$/  recommendations: Recommendation[],\n  context?: CallContext/g' "$FILE"

# Update assembleResult call to callClaude
sed -i '' "s/const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble')/const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble', SONNET, context)/g" "$FILE"

# Update deduplicateRecommendations signature and return type
sed -i '' 's/function deduplicateRecommendations(recs: Recommendation\[\]): Recommendation\[\] {/function deduplicateRecommendations(\n  recs: Recommendation[],\n  context?: CallContext\n): { deduped: Recommendation[]; mergeMap: Record<string, number[]> } {/g' "$FILE"

# Update analyzeProtocol signature
sed -i '' 's/export async function analyzeProtocol(/export async function analyzeProtocol(/g' "$FILE"
sed -i '' 's/  onProgress?: (event: ProgressEvent) => void$/  onProgress?: (event: ProgressEvent) => void,\n  context?: CallContext/g' "$FILE"

# Update analyzeProtocol internal calls
sed -i '' 's/const parsed = await parseProtocol(protocolText)/const parsed = await parseProtocol(protocolText, context)/g' "$FILE"
sed -i '' 's/const rawRecommendations = await evaluateAllPrinciples(parsed.steps, onProgress)/const rawRecommendations = await evaluateAllPrinciples(parsed.steps, onProgress, context)/g' "$FILE"
sed -i '' 's/const assembled = await assembleResult(protocolText, parsed.steps, recommendations)/const assembled = await assembleResult(protocolText, parsed.steps, recommendations, context)/g' "$FILE"

echo "Function signatures updated. Now updating deduplication logic..."

# Note: The dedup logic changes are more complex and need to be done manually
# We'll create a separate sed script for those

echo "Script completed. Please review changes and test."
