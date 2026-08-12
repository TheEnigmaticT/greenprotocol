import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from import_evidence_units_supabase import build_import_batches, import_evidence


class Response:
    def __init__(self, status_code=201):
        self.status_code = status_code
        self.text = "request failed"


class FakeSession:
    def __init__(self, statuses=()):
        self.statuses = iter(statuses)
        self.requests = []

    def post(self, url, *, json, headers, timeout):
        self.requests.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return Response(next(self.statuses, 201))


def fixture_records():
    sources = {
        "doc-1": {
            "canonical_id": "doc-1",
            "title": "Article",
            "status": "canonical",
            "document_type": "research_article",
            "doi": "10.1000/example",
        }
    }
    unit = {
        "evidence_unit_id": "doc-1:p2:u0",
        "document_id": "doc-1",
        "title": "Article",
        "page_start": 2,
        "page_end": 2,
        "quote": "A sufficiently long quote.",
        "signal_groups": ["comparison"],
        "candidate_status": "candidate_pending_adjudication",
    }
    embedding = {
        "evidence_unit_id": "doc-1:p2:u0",
        "embedding_model": "text-embedding-3-small",
        "embedding": [0.1] * 1536,
    }
    return sources, [unit], {unit["evidence_unit_id"]: embedding}


def write_inputs(tmp_path, sources, units, embeddings):
    article_index = tmp_path / "article-index.jsonl"
    evidence = tmp_path / "evidence.jsonl"
    embedding_file = tmp_path / "embeddings.jsonl"
    article_index.write_text("\n".join(json.dumps(source) for source in sources.values()) + "\n")
    evidence.write_text("\n".join(json.dumps(unit) for unit in units) + "\n")
    embedding_file.write_text("\n".join(json.dumps(item) for item in embeddings.values()) + "\n")
    return article_index, evidence, embedding_file


def test_build_import_batches_rejects_orphan_and_missing_embedding():
    sources = {"doc-1": {"canonical_id": "doc-1", "title": "Article", "status": "canonical", "document_type": "research_article"}}
    unit = {"evidence_unit_id": "missing:p1:u0", "document_id": "missing", "title": "Article", "page_start": 1, "page_end": 1, "quote": "A sufficiently long quote.", "signal_groups": []}
    with pytest.raises(ValueError, match="source document"):
        build_import_batches(sources, [unit], {})

def test_build_import_batches_rejects_missing_embedding_for_known_source():
    sources, units, _ = fixture_records()
    with pytest.raises(ValueError, match="missing embedding"):
        build_import_batches(sources, units, {})


def test_batch_preserves_candidate_status_pages_and_embedding_model():
    documents, units = build_import_batches(*fixture_records())
    assert units[0]["candidate_status"] == "candidate_pending_adjudication"
    assert (units[0]["page_start"], units[0]["page_end"], units[0]["embedding_model"]) == (2, 2, "text-embedding-3-small")


def test_build_import_batches_rejects_non_retrieval_embedding_model():
    sources, units, embeddings = fixture_records()
    embeddings[units[0]["evidence_unit_id"]]["embedding_model"] = "other-1536-model"
    with pytest.raises(ValueError, match="text-embedding-3-small"):
        build_import_batches(sources, units, embeddings)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda sources, units, embeddings: units[0].update(page_start=3, page_end=2), "page range"),
        (lambda sources, units, embeddings: units.append(dict(units[0])), "duplicate evidence"),
        (lambda sources, units, embeddings: embeddings[units[0]["evidence_unit_id"]].update(embedding=[0.1] * 1535), "1536"),
    ],
)
def test_build_import_batches_rejects_invalid_evidence(mutate, message):
    sources, units, embeddings = fixture_records()
    mutate(sources, units, embeddings)
    with pytest.raises(ValueError, match=message):
        build_import_batches(sources, units, embeddings)


def test_failed_batch_leaves_incomplete_manifest(tmp_path):
    sources, units, embeddings = fixture_records()
    paths = write_inputs(tmp_path, sources, units, embeddings)
    manifest = tmp_path / "manifest.json"
    with pytest.raises(RuntimeError, match="status 500"):
        import_evidence(*paths, manifest, "https://example.test", "secret", session=FakeSession([201, 500]), batch_size=1)
    saved = json.loads(manifest.read_text())
    assert saved["complete"] is False
    assert saved["completed_unit_id"] is None
    assert saved["unit_count"] == 1


def test_resume_uses_last_successful_id_and_rerun_excludes_completed_payload(tmp_path):
    sources, units, embeddings = fixture_records()
    second = dict(units[0], evidence_unit_id="doc-1:p3:u0", page_start=3, page_end=3)
    units.append(second)
    embeddings[second["evidence_unit_id"]] = dict(embeddings["doc-1:p2:u0"], evidence_unit_id=second["evidence_unit_id"])
    paths = write_inputs(tmp_path, sources, units, embeddings)
    manifest = tmp_path / "manifest.json"
    with pytest.raises(RuntimeError):
        import_evidence(*paths, manifest, "https://example.test", "secret", session=FakeSession([201, 201, 500]), batch_size=1)
    resumed = FakeSession()
    result = import_evidence(*paths, manifest, "https://example.test", "secret", session=resumed, batch_size=1)
    evidence_requests = [request for request in resumed.requests if "literature_evidence_units" in request["url"]]
    assert [row["id"] for row in evidence_requests[0]["json"]] == ["doc-1:p3:u0"]
    assert result["complete"] is True
    rerun = FakeSession()
    import_evidence(*paths, manifest, "https://example.test", "secret", session=rerun, batch_size=1)
    assert rerun.requests == []


def test_checksum_mismatch_rejects_before_network_io(tmp_path):
    sources, units, embeddings = fixture_records()
    paths = write_inputs(tmp_path, sources, units, embeddings)
    manifest = tmp_path / "manifest.json"
    checksums = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    manifest.write_text(json.dumps({"checksums": checksums, "complete": False, "completed_unit_id": None}))
    paths[1].write_text(paths[1].read_text() + "\n")
    session = FakeSession()
    with pytest.raises(ValueError, match="checksum"):
        import_evidence(*paths, manifest, "https://example.test", "secret", session=session)
    assert session.requests == []


def test_resume_accepts_a_different_invocation_batch_size(tmp_path):
    sources, units, embeddings = fixture_records()
    second = dict(units[0], evidence_unit_id="doc-1:p3:u0", page_start=3, page_end=3)
    units.append(second)
    embeddings[second["evidence_unit_id"]] = dict(embeddings["doc-1:p2:u0"], evidence_unit_id=second["evidence_unit_id"])
    paths = write_inputs(tmp_path, sources, units, embeddings)
    manifest = tmp_path / "manifest.json"
    with pytest.raises(RuntimeError):
        import_evidence(*paths, manifest, "https://example.test", "secret", session=FakeSession([201, 201, 500]), batch_size=1)
    resumed = FakeSession()
    import_evidence(*paths, manifest, "https://example.test", "secret", session=resumed, batch_size=2)
    evidence_requests = [request for request in resumed.requests if "literature_evidence_units" in request["url"]]
    assert [row["id"] for row in evidence_requests[0]["json"]] == ["doc-1:p3:u0"]
