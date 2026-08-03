#!/usr/bin/env python3
"""Generate resumable OpenAI dense embeddings for candidate evidence units."""
from __future__ import annotations
import argparse,json,time
from pathlib import Path
from openai import OpenAI

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--input',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--model',default='text-embedding-3-small'); ap.add_argument('--batch-size',type=int,default=64); a=ap.parse_args()
 rows=[json.loads(x) for x in a.input.read_text().splitlines() if x.strip()]
 done={}
 if a.output.exists():
  done={json.loads(x)['evidence_unit_id']:json.loads(x) for x in a.output.read_text().splitlines() if x.strip()}
 client=OpenAI()
 a.output.parent.mkdir(parents=True,exist_ok=True)
 with a.output.open('a') as fh:
  pending=[r for r in rows if r['evidence_unit_id'] not in done]
  for start in range(0,len(pending),a.batch_size):
   batch=pending[start:start+a.batch_size]
   inputs=[f"{r.get('title','')}\n{r.get('quote','')}\nSignals: {', '.join(r.get('signal_groups',[]))}" for r in batch]
   last=None
   for attempt in range(5):
    try:
     resp=client.embeddings.create(model=a.model,input=inputs)
     for r,item in zip(batch,resp.data):
      out={'evidence_unit_id':r['evidence_unit_id'],'embedding_model':a.model,'embedding':item.embedding}
      fh.write(json.dumps(out)+'\n')
     fh.flush(); last=None; break
    except Exception as e:
     last=e; time.sleep(2**attempt)
   if last: raise last
   processed=min(start+len(batch),len(pending)); print(json.dumps({'processed':processed,'pending':len(pending),'total':len(rows)}),flush=True)
 print(json.dumps({'embedded_total':len(done)+len(pending),'output':str(a.output),'model':a.model}))
if __name__=='__main__': main()
