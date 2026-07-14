# Literature Ingestion Pipeline

This directory contains scripts to ingest green chemistry literature from open-access sources into the vector database for citable recommendations.

## Priority Sources

### 1. ACS Sustainable Chemistry & Engineering (Open Access)
- **API**: PubMed Central (PMC) API for open-access articles
- **Alternative**: CrossRef API with filter `is-referenced-by-count:*` and `type:journal-article`
- **Format**: DOI, title, authors, abstract, year
- **Access**: Free via PMC API: https://www.ncbi.nlm.nih.gov/pmc/tools/developers/

### 2. Green Chemistry Journal (RSC, Open Access Subset)
- **API**: CrossRef API filtered by ISSN and license
- **ISSN**: 1463-9262 (print), 1463-9270 (electronic)
- **Access**: Free via CrossRef: https://api.crossref.org/works

### 3. CHEM21 Solvent Guide
- **Source**: Published methodology papers and solvent selection guide
- **DOI**: 10.1039/c5gc01008j (main guide)
- **Access**: Direct scraping of open-access PDFs or manual entry

### 4. EPA Safer Chemical Ingredients List
- **Source**: EPA CompTox Dashboard
- **API**: https://comptox.epa.gov/dashboard/api
- **Access**: Free public API for chemical hazard data

### 5. EPA P2 Pollution Prevention Library
- **Source**: https://www.epa.gov/p2
- **Access**: Web scraping or manual curation of case studies

### 6. ACS GCI Pharmaceutical Roundtable
- **Source**: Published benchmark datasets
- **Access**: Manual curation from open-access publications

### 7. ChemRxiv Preprints
- **API**: ChemRxiv API (Figshare-based)
- **Access**: https://chemrxiv.org/engage/chemrxiv/public-api/documentation

## Implementation Plan

1. **Phase 1**: PubMed Central + CrossRef (automated)
2. **Phase 2**: ChemRxiv preprints (automated)
3. **Phase 3**: EPA sources (semi-automated)
4. **Phase 4**: Manual curation for CHEM21 and ACS GCI

## Data Model

Each ingested article creates a record in `literature_precedents`:

```typescript
{
  title: string
  authors: string
  journal: string
  year: number
  doi: string
  url: string
  abstract: string
  content_snippet: string
  embedding: vector(1536)
  chemical_subjects: string[]
  principles_addressed: number[]
  hazard_types: string[]
}
```

## Usage

```bash
# Install dependencies
npm install

# Run ingestion for PubMed Central
node scripts/literature-ingestion/ingest-pmc.js

# Run ingestion for CrossRef
node scripts/literature-ingestion/ingest-crossref.js

# Run ingestion for ChemRxiv
node scripts/literature-ingestion/ingest-chemrxiv.js
```

## Citation Format

Citations are rendered in ACS format:

> Author1, A.; Author2, B. Title. *Journal* **Year**, *Volume*, Pages. DOI: 10.xxxx/xxxxx

Example:
> Prat, D.; Wells, A.; Hayler, J.; Sneddon, H.; McElroy, C. R.; Abou-Shehada, S.; Dunn, P. J. CHEM21 Selection Guide of Classical- and Less Classical-Solvents. *Green Chem.* **2016**, *18*, 288–296. DOI: 10.1039/c5gc01008j
