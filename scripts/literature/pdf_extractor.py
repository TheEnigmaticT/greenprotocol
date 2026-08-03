"""PDF extraction backends for the literature ingestion pipeline.

The adapter keeps the ingest contract stable while allowing the parser to be
benchmarked or changed without touching provenance, metadata, or chunking.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


PAGE_BREAK = "\n\n--- PAGE BREAK ---\n\n"


@dataclass(frozen=True)
class ExtractionResult:
    text: str
    page_count: int
    page_text_lengths: list[int]
    pdf_type: str | None = None
    confidence: float | None = None
    pages_needing_ocr: list[int] | None = None
    pages_with_tables: list[int] | None = None
    pages_with_columns: list[int] | None = None
    has_encoding_issues: bool | None = None
    extractor: str = "unknown"
    extractor_version: str | None = None


def _version(module: Any) -> str | None:
    version = getattr(module, "__version__", None)
    if version:
        return version
    try:
        from importlib.metadata import version as package_version

        return package_version("pdf-inspector")
    except Exception:
        return None


def result_from_pdf_inspector(result: Any, *, extractor_version: str | None = None) -> ExtractionResult:
    """Normalize pdf-inspector output to the ingest pipeline's page-aware shape."""
    pages = getattr(result, "pages", None)
    if pages:
        page_texts = [getattr(page, "markdown", "") or "" for page in pages]
        text = PAGE_BREAK.join(page_texts)
        page_count = getattr(result, "page_count", len(page_texts))
    else:
        text = getattr(result, "markdown", None) or ""
        page_count = getattr(result, "page_count", 1)
        page_texts = [text] if text else []

    return ExtractionResult(
        text=text,
        page_count=page_count,
        page_text_lengths=[len(page) for page in page_texts],
        pdf_type=getattr(result, "pdf_type", None),
        confidence=getattr(result, "confidence", None),
        pages_needing_ocr=getattr(result, "pages_needing_ocr", None),
        pages_with_tables=getattr(result, "pages_with_tables", None),
        pages_with_columns=getattr(result, "pages_with_columns", None),
        has_encoding_issues=getattr(result, "has_encoding_issues", None),
        extractor="pdf-inspector",
        extractor_version=extractor_version,
    )


def extract_with_pdf_inspector(data: bytes) -> ExtractionResult:
    import pdf_inspector

    result = pdf_inspector.extract_pages_markdown_bytes(data)
    detected = pdf_inspector.detect_pdf_bytes(data)
    normalized = result_from_pdf_inspector(result, extractor_version=_version(pdf_inspector))
    return ExtractionResult(
        **{
            **normalized.__dict__,
            "pdf_type": getattr(detected, "pdf_type", normalized.pdf_type),
            "confidence": getattr(detected, "confidence", normalized.confidence),
            "pages_needing_ocr": getattr(result, "pages_needing_ocr", getattr(detected, "pages_needing_ocr", normalized.pages_needing_ocr)),
            "pages_with_tables": getattr(result, "pages_with_tables", normalized.pages_with_tables),
            "pages_with_columns": getattr(result, "pages_with_columns", normalized.pages_with_columns),
            "has_encoding_issues": getattr(detected, "has_encoding_issues", normalized.has_encoding_issues),
        }
    )


def extract_with_pymupdf(data: bytes) -> ExtractionResult:
    import fitz

    doc = fitz.open(stream=data, filetype="pdf")
    pages = [page.get_text("text") for page in doc]
    return ExtractionResult(
        text=PAGE_BREAK.join(pages),
        page_count=len(pages),
        page_text_lengths=[len(page) for page in pages],
        extractor="pymupdf",
        extractor_version=getattr(fitz, "__version__", None),
    )


def extract_pdf(data: bytes, extractor: str = "pdf-inspector") -> ExtractionResult:
    if extractor == "pdf-inspector":
        return extract_with_pdf_inspector(data)
    if extractor == "pymupdf":
        return extract_with_pymupdf(data)
    raise ValueError(f"Unsupported PDF extractor: {extractor}")
