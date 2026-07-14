import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { GCAI_VERSION } from '@/lib/version';
import type { ScoreProvenance } from '@/lib/types';

// Map provenance codes to user-friendly labels for export
const PROVENANCE_LABELS: Record<ScoreProvenance, string> = {
  'declared': 'Declared (from protocol)',
  'calculated': 'Calculated (deterministic)',
  'benchmark': 'Benchmark-derived (ACS GCI)',
  'model-inferred': 'AI-estimated (review reasoning)',
  'unavailable': 'Unavailable (missing data)',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id } = await params;

  // 1. Fetch the analysis
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  // 2. Prepare DOZN Data
  // Map internal analysis structure to DOZN spreadsheet format
  const analysisResult = analysis.analysis_result || {};
  const scores = analysisResult.deterministicScores?.scores || [];
  
  // Build score rows with provenance
  const scoreRows = scores.map((score: any) => ({
    principle_number: score.principle_number,
    principle_name: score.principle_name,
    score: score.score,
    max_score: score.max_score,
    provenance: PROVENANCE_LABELS[score.confidence as ScoreProvenance] || score.confidence,
    data_sources: score.data_sources.join(', '),
    flagged_chemicals: score.chemicals_flagged.join(', '),
  }));
  
  const doznData = {
    protocol_name: analysis.protocol_name || analysisResult.protocolTitle || 'Protocol Analysis',
    date: new Date().toISOString().split('T')[0],
    // Citability: stamp the build that generated the export.
    software_version: `GreenChemistry.ai v${GCAI_VERSION}`,
    metadata: {
      analysis_id: id,
      exported_at: new Date().toISOString(),
      provenance_taxonomy_version: '1.0',
    },
    steps: analysisResult.steps || [],
    scores: scoreRows,
    recommendations: analysisResult.recommendations || [],
    // This is where we'd add the logic to populate the spreadsheet
  };

  // For this task, we are "building an API endpoint"
  // Since we don't have a live Google Sheets API setup here, 
  // we return the structured data that the Apps Script would consume.
  
  return NextResponse.json({
    success: true,
    template_url: "https://docs.google.com/spreadsheets/d/1_DOZN_TEMPLATE_ID/edit",
    data: doznData
  });
}
