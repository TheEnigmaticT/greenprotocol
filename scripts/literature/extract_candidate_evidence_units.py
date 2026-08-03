#!/usr/bin/env python3
"""Extract candidate evidence units from page-preserving article text.

Candidates are retrieval/adjudication seeds, not validated claims. They retain
page and source provenance and must be reviewed before recommendation use.
"""
from __future__ import annotations
import argparse,json,re
from pathlib import Path

SIGNALS={
 'comparison':['compared','versus',' v. ','alternative','substitut','replace','instead of','benchmark'],
 'process':['synthes','reaction','catalyst','solvent','reagent','extraction','purif','separation','one-pot','optimization'],
 'outcome':['yield','purity','selectivity','conversion','recovery','runtime','time','temperature','energy','waste','pmi','emission','recycl'],
 'hazard':['hazard','toxic','safer','corrosion','flammab','safety','ecotoxic'],
}

def sentence_windows(text:str):
    paragraphs=[p.strip().replace('\n',' ') for p in re.split(r'\n\s*\n',text) if p.strip()]
    for p in paragraphs:
        sents=re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])',p)
        for i,s in enumerate(sents):
            if len(s)<80: continue
            low=s.lower()
            hits=[group for group,terms in SIGNALS.items() if any(t in low for t in terms)]
            if len(hits)>=2 or ('comparison' in hits and len(hits)>=1):
                lo=max(0,i-1); hi=min(len(sents),i+2)
                quote=' '.join(sents[lo:hi]).strip()
                # Exclude bibliography/reference-list material and citation-only prose.
                citation_markers=len(re.findall(r'\[[0-9][^\]]*\]|\([A-Z][^)]{2,80}\s+et al\.,?\s*\d{4}\)',quote))
                journal_markers=len(re.findall(r'(?:doi:|https?://|\bJ\.|\bInt\.|\bChem\.|\bBiotechnol\.|\bElsevier|\bSpringer)',quote,flags=re.I))
                bibliography_author_shape=len(re.findall(r'\b[A-Z][a-z]+,\s*[A-Z](?:\.[A-Z]?)+',quote))
                year_page_shape=bool(re.search(r'\b\d{4}\b.*\b\d+\s*[-–]\s*\d+\b',quote))
                starts_author_citation=bool(re.match(r'^\s*[A-Z][a-z]+,\s*[A-Z]\.',quote))
                bibliography_like=(starts_author_citation and journal_markers >= 1) or (bibliography_author_shape >= 2 and (journal_markers >= 1 or citation_markers >= 1 or year_page_shape))
                if citation_markers >= 3 or journal_markers >= 3 or bibliography_like:
                    continue
                if 120<=len(quote)<=1800:
                    yield quote, sorted(set(hits))

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--extracted-dir',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); args=ap.parse_args()
    rows=[]; seen=set()
    for line in (args.extracted_dir/'article-index.jsonl').read_text().splitlines():
        r=json.loads(line)
        if r.get('status')!='canonical' or r.get('document_type')!='research_article': continue
        text=Path(r['text_path']).read_text(errors='ignore')
        pages=text.split('\n\n--- PAGE BREAK ---\n\n')
        for page_no,page in enumerate(pages,1):
            for n,(quote,signals) in enumerate(sentence_windows(page)):
                key=(r['canonical_id'],page_no,quote)
                if key in seen: continue
                seen.add(key)
                rows.append({'evidence_unit_id':f"{r['canonical_id']}:p{page_no}:u{n}",'document_id':r['canonical_id'],'doi':r.get('doi'),'title':r.get('title'),'volume':r.get('volume'),'year':r.get('year'),'page_start':page_no,'page_end':page_no,'quote':quote,'signal_groups':signals,'evidence_type':None,'normalized_claim':None,'conditions':None,'reported_metrics':None,'applicability':None,'limitations':None,'candidate_status':'candidate_pending_adjudication','source_pdf':r['source_pdf'],'text_path':r['text_path']})
    args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text('\n'.join(json.dumps(r,ensure_ascii=False) for r in rows)+'\n')
    print(json.dumps({'articles':len({r['document_id'] for r in rows}),'candidate_units':len(rows),'output':str(args.output)},indent=2))
if __name__=='__main__': main()
