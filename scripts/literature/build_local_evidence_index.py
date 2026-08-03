#!/usr/bin/env python3
"""Build a local searchable evidence index with SQLite FTS5.

This is the credential-free first retrieval layer. Embedding columns and the
Supabase pgvector migration remain separate so hosted embeddings can be added
without changing the citation/provenance model.
"""
from __future__ import annotations
import argparse,json,sqlite3
from pathlib import Path

def connect(path:Path):
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
    DROP TABLE IF EXISTS article_context;
    DROP TABLE IF EXISTS evidence_units;
    DROP TABLE IF EXISTS article_fts;
    DROP TABLE IF EXISTS evidence_fts;
    CREATE TABLE article_context(
      document_id TEXT PRIMARY KEY, doi TEXT, title TEXT NOT NULL,
      volume INTEGER, year INTEGER, journal TEXT, source_pdf TEXT,
      text_path TEXT, metadata_json TEXT NOT NULL,
      embedding_model TEXT, embedding_json TEXT
    );
    CREATE TABLE evidence_units(
      evidence_unit_id TEXT PRIMARY KEY, document_id TEXT NOT NULL,
      doi TEXT, title TEXT NOT NULL, volume INTEGER, year INTEGER,
      page_start INTEGER, page_end INTEGER, quote TEXT NOT NULL,
      signal_groups TEXT, evidence_type TEXT, normalized_claim TEXT,
      conditions TEXT, reported_metrics TEXT, applicability TEXT,
      limitations TEXT, candidate_status TEXT NOT NULL,
      source_pdf TEXT, text_path TEXT, embedding_model TEXT, embedding_json TEXT
    );
    CREATE VIRTUAL TABLE article_fts USING fts5(document_id UNINDEXED, title, body, tokenize='unicode61');
    CREATE VIRTUAL TABLE evidence_fts USING fts5(evidence_unit_id UNINDEXED, document_id UNINDEXED, title, quote, signal_groups, tokenize='unicode61');
    CREATE INDEX idx_evidence_doc ON evidence_units(document_id);
    CREATE INDEX idx_evidence_doi ON evidence_units(doi);
    CREATE INDEX idx_evidence_page ON evidence_units(document_id,page_start);
    ''')
    return db

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--extracted-dir',type=Path,required=True); ap.add_argument('--candidate-units',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); args=ap.parse_args()
    db=connect(args.output)
    article_rows=[]
    for line in (args.extracted_dir/'article-index.jsonl').read_text().splitlines():
        r=json.loads(line)
        if r.get('status')!='canonical' or r.get('document_type')!='research_article': continue
        text=Path(r['text_path']).read_text(errors='ignore')
        # Title plus bounded early text gives a stable article-context query field.
        excerpt=text[:12000]
        db.execute('INSERT INTO article_context VALUES (?,?,?,?,?,?,?,?,?,?,?)',(
          r['canonical_id'],r.get('doi'),r.get('title') or '',r.get('volume'),r.get('year'),
          'Current Research in Green and Sustainable Chemistry',r.get('source_pdf'),r.get('text_path'),json.dumps(r,ensure_ascii=False),None,None))
        db.execute('INSERT INTO article_fts(document_id,title,body) VALUES (?,?,?)',(r['canonical_id'],r.get('title') or '',excerpt))
        article_rows.append(r['canonical_id'])
    unit_count=0
    for line in args.candidate_units.read_text().splitlines():
        r=json.loads(line)
        db.execute('INSERT INTO evidence_units VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(
          r['evidence_unit_id'],r['document_id'],r.get('doi'),r.get('title') or '',r.get('volume'),r.get('year'),
          r.get('page_start'),r.get('page_end'),r['quote'],json.dumps(r.get('signal_groups',[])),r.get('evidence_type'),
          r.get('normalized_claim'),r.get('conditions'),r.get('reported_metrics'),r.get('applicability'),r.get('limitations'),
          r.get('candidate_status','candidate_pending_adjudication'),r.get('source_pdf'),r.get('text_path'),None,None))
        db.execute('INSERT INTO evidence_fts(evidence_unit_id,document_id,title,quote,signal_groups) VALUES (?,?,?,?,?)',(
          r['evidence_unit_id'],r['document_id'],r.get('title') or '',r['quote'], ' '.join(r.get('signal_groups',[]))))
        unit_count+=1
    db.commit()
    counts={'articles':len(article_rows),'evidence_units':unit_count,'output':str(args.output)}
    print(json.dumps(counts,indent=2))
if __name__=='__main__': main()
