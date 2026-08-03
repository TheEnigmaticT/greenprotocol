#!/usr/bin/env python3
"""Build/query a local sparse vector index over evidence units."""
from __future__ import annotations
import argparse,json,pickle,sqlite3
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from scipy.sparse import save_npz,load_npz

def build(db_path:Path,out_dir:Path):
    db=sqlite3.connect(db_path)
    rows=db.execute('SELECT evidence_unit_id,document_id,doi,title,page_start,quote,signal_groups FROM evidence_units ORDER BY evidence_unit_id').fetchall()
    ids=[r[0] for r in rows]
    docs=[f'{r[3]}\n{r[5]}\n{r[6]}' for r in rows]
    vec=TfidfVectorizer(lowercase=True,ngram_range=(1,2),min_df=2,max_df=.98,sublinear_tf=True,strip_accents='unicode')
    mat=normalize(vec.fit_transform(docs))
    out_dir.mkdir(parents=True,exist_ok=True); save_npz(out_dir/'matrix.npz',mat)
    (out_dir/'metadata.json').write_text(json.dumps({'ids':ids,'rows':[{'evidence_unit_id':r[0],'document_id':r[1],'doi':r[2],'title':r[3],'page_start':r[4]} for r in rows]},ensure_ascii=False))
    with (out_dir/'vectorizer.pkl').open('wb') as f: pickle.dump(vec,f)
    print(json.dumps({'units':len(rows),'features':len(vec.vocabulary_),'output':str(out_dir)},indent=2))

def query(index:Path,text:str,k:int):
    mat=load_npz(index/'matrix.npz'); meta=json.loads((index/'metadata.json').read_text())
    with (index/'vectorizer.pkl').open('rb') as f: vec=pickle.load(f)
    q=normalize(vec.transform([text])); scores=(mat@q.T).toarray().ravel(); order=scores.argsort()[::-1][:k]
    print(json.dumps([dict(meta['rows'][i],score=round(float(scores[i]),5)) for i in order],ensure_ascii=False,indent=2))

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    b=sub.add_parser('build'); b.add_argument('--db',type=Path,required=True); b.add_argument('--output',type=Path,required=True)
    q=sub.add_parser('query'); q.add_argument('--index',type=Path,required=True); q.add_argument('--text',required=True); q.add_argument('--k',type=int,default=10)
    a=ap.parse_args(); build(a.db,a.output) if a.cmd=='build' else query(a.index,a.text,a.k)
if __name__=='__main__': main()
