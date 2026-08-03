from __future__ import annotations

from scripts.literature.pdf_extractor import ExtractionResult, result_from_pdf_inspector


def test_result_from_pdf_inspector_preserves_page_boundaries_and_routing_metadata():
    result = result_from_pdf_inspector(
        type(
            "Result",
            (),
            {
                "pdf_type": "mixed",
                "confidence": 0.91,
                "page_count": 2,
                "pages_needing_ocr": [1],
                "pages_with_tables": [2],
                "pages_with_columns": [2],
                "has_encoding_issues": False,
                "pages": [
                    type("Page", (), {"page": 0, "markdown": "first page"})(),
                    type("Page", (), {"page": 1, "markdown": "second page"})(),
                ],
            },
        )()
    )

    assert isinstance(result, ExtractionResult)
    assert result.text == "first page\n\n--- PAGE BREAK ---\n\nsecond page"
    assert result.page_count == 2
    assert result.page_text_lengths == [10, 11]
    assert result.pdf_type == "mixed"
    assert result.confidence == 0.91
    assert result.pages_needing_ocr == [1]
    assert result.pages_with_tables == [2]
    assert result.pages_with_columns == [2]
    assert result.has_encoding_issues is False


def test_result_from_pdf_inspector_uses_markdown_when_page_metadata_is_unavailable():
    result = result_from_pdf_inspector(
        type(
            "Result",
            (),
            {
                "pdf_type": "text_based",
                "confidence": 1.0,
                "page_count": 1,
                "pages_needing_ocr": [],
                "pages_with_tables": [],
                "pages_with_columns": [],
                "has_encoding_issues": False,
                "markdown": "# Title\n\nBody",
            },
        )()
    )

    assert result.text == "# Title\n\nBody"
    assert result.page_count == 1
    assert result.page_text_lengths == [13]
