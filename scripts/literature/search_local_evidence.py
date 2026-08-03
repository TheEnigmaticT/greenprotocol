#!/usr/bin/env python3
"""Hybrid local retrieval over article-context/evidence-unit FTS5 and TF-IDF vectors."""
from __future__ import annotations
import argparse,json,pickle,sqlite3
from pathlib import Path
import numpy as np
from scipy.sparse import load_npz

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--db',type=Path,required=True); ap.add_argument('--tfidf-index',type=Path,required=True); ap.add_argument('--query',required=True); ap.add_argument('--k',type=int,default=10); args=ap.parse_args()
 db=sqlite3.connect(args.db); idx=args.tfidf_index
 meta=json.loads((idx/'metadata.json').read_text()); mat=load_npz(idx/'matrix.npz')
 with (idx/'vectorizer.pkl').open('rb') as f: vec=pickle.load(f)
 q=vec.transform([args.query]); dense=(mat@q.T).toarray().ravel(); dense_order=np.argsort(dense)[::-1][:max(args.k*5,50)]
 fts=[]
 try:
  fts=db.execute("SELECT evidence_unit_id,bm25(evidence_fts) AS rank FROM evidence_fts WHERE evidence_fts MATCH ? ORDER BY rank LIMIT ?",(args.query,args.k*5)).fetchall()
 except sqlite3.OperationalError:
  # FTS syntax can reject punctuation in chemical queries; fall back to quoted terms.
  terms=' '.join('"'+t.replace('"','')+'"' for t in args.query.split() if t)
  fts=db.execute("SELECT evidence_unit_id,bm25(evidence_fts) AS rank FROM evidence_fts WHERE evidence_fts MATCH ? ORDER BY rank LIMIT ?",(terms,args.k*5)).fetchall()
 scores={}
 for rank,i in enumerate(dense_order,1): scores[meta['rows'][i]['evidence_unit_id']]=scores.get(meta['rows'][i]['evidence_unit_id'],0)+0.65/(50+rank)
 for rank,(uid,_) in enumerate(fts,1): scores[uid]=scores.get(uid,0)+0.35/(50+rank)
 ranked=sorted(scores,key=scores.get,reverse=True)[:args.k]
 out=[]
 for uid in ranked:
  r=db.execute('SELECT evidence_unit_id,document_id,doi,title,page_start,page_end,quote,signal_groups,candidate_status FROM evidence_units WHERE evidence_unit_id=?',(uid,)).fetchone()
  out.append({'evidence_unit_id':r[0],'document_id':r[1],'doi':r[2],'title':r[3],'page_start':r[4],'page_end':r[5],'quote':r[6],'signal_groups':json.loads(r[7]),'candidate_status':r[8],'hybrid_score':round(scores[uid],6)})
 print(json.dumps({'query':args.query,'results':out},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
