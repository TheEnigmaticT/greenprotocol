"""Script to build validation sets from PubMed literature."""

import asyncio
import json
import os
from pubmed import ingest_literature_for_chemical

# Chemicals we want to find evidence-backed substitutions for
SEED_CHEMICALS = [
    "Dichloromethane",
    "Dimethylformamide",
    "N-Methyl-2-pyrrolidone",
    "Benzene",
    "Toluene",
    "Diethyl ether"
]

async def build_validation_sets():
    print(f"Starting PubMed ingestion for {len(SEED_CHEMICALS)} chemicals...")
    
    all_records = {}
    validation_set = []

    for chem in SEED_CHEMICALS:
        print(f"Processing {chem}...")
        articles = await ingest_literature_for_chemical(chem)
        print(f"  Found {len(articles)} articles")
        
        all_records[chem] = articles
        
        # Build a simple validation entry if we found articles
        if articles:
            # We use the first article as a potential evidence source
            best_article = articles[0]
            validation_set.append({
                "target_chemical": chem,
                "evidence_pmid": best_article["pmid"],
                "evidence_title": best_article["title"],
                "context": best_article["abstract"][:500] + "..." if best_article["abstract"] else "No abstract available",
                "proposed_substitutions": [] # To be populated by LLM analysis later
            })

    # Save results - fixing path to be within repo
    repo_root = "/Users/ct-mac-mini/dev/greenchemistry-ai"
    output_dir = f"{repo_root}/services/chemistry/data/ingested"
    os.makedirs(output_dir, exist_ok=True)
    
    with open(f"{output_dir}/pubmed_records.json", "w") as f:
        json.dump(all_records, f, indent=2)
    
    with open(f"{output_dir}/validation_set_0.5.x.json", "w") as f:
        json.dump(validation_set, f, indent=2)

    print(f"\nDone! Ingested records for {len(all_records)} chemicals.")
    print(f"Created validation set with {len(validation_set)} entries.")
    print(f"Results saved to {output_dir}/")

if __name__ == "__main__":
    asyncio.run(build_validation_sets())
