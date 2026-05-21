"""PubMed API client for literature retrieval."""

import httpx
import asyncio
from typing import List, Dict, Any

PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
PUBMED_HEADERS = {
    "User-Agent": (
        "GreenProtoCol/0.5 "
        "(greenchemistry.ai; contact: support@greenchemistry.ai)"
    ),
}

async def fetch_pubchem_json(url: str, label: str) -> dict | None:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=PUBCHEM_HEADERS) as client:
        for attempt in range(3):
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            print(f"[pubchem] lookup failed for {label}: HTTP {resp.status_code}")
            return None
    return None

async def call_pubmed(url: str, params: Dict[str, Any], label: str) -> Dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=30.0, headers=PUBMED_HEADERS) as client:
        for attempt in range(5):
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429 and attempt < 4:
                # PubMed rate limit: 3 requests/sec without API key
                wait_time = 1.0 * (attempt + 1)
                print(f"[pubmed] rate limited for {label}, waiting {wait_time}s...")
                await asyncio.sleep(wait_time)
                continue
            print(f"[pubmed] {label} failed: HTTP {resp.status_code}")
            return None
    return None

async def search_pubmed(query: str, max_results: int = 10) -> List[str]:
    """Search PubMed and return a list of PMIDs."""
    params = {
        "db": "pubmed",
        "term": query,
        "retmax": max_results,
        "retmode": "json",
    }
    data = await call_pubmed(PUBMED_ESEARCH, params, "search")
    if data:
        return data.get("esearchresult", {}).get("idlist", [])
    return []

async def fetch_pubmed_details(pmids: List[str]) -> List[Dict[str, Any]]:
    """Fetch details for a list of PMIDs."""
    if not pmids:
        return []
    
    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "json",
    }
    data = await call_pubmed(PUBMED_ESUMMARY, params, "fetch")
    if data:
        return parse_pubmed_json(data)
    return []

def parse_pubmed_json(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parse PubMed JSON response (from esummary)."""
    articles = []
    result = data.get("result", {})
    uids = result.get("uids", [])
    
    for uid in uids:
        item = result.get(uid, {})
        articles.append({
            "pmid": uid,
            "title": item.get("title", "No title"),
            "abstract": item.get("description", ""), # esummary usually only gives title/metadata
            "journal": item.get("fulljournalname", ""),
            "year": item.get("pubdate", "").split(" ")[0],
            "source": "PubMed"
        })
    return articles

async def ingest_literature_for_chemical(chemical_name: str) -> List[Dict[str, Any]]:
    """Search and ingest green chemistry literature for a chemical."""
    # Focused query for green chemistry substitutions
    query = f'"{chemical_name}" AND "green chemistry" AND "substitution"'
    pmids = await search_pubmed(query, max_results=5)
    return await fetch_pubmed_details(pmids)
