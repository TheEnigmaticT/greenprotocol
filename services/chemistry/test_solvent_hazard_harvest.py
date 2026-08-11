import io
import json
import sqlite3
import stat
from email.message import Message
from pathlib import Path

import pytest
import solvent_hazard_harvest

from urllib.error import HTTPError
from solvent_evidence_store import SolventEvidenceStore
from solvent_hazard_harvest import (
    HttpResponse,
    HarvesterAlreadyRunningError,
    UrllibPubChemClient,
    _worker_lock,
    harvest_hazards,
)

DMF_GHS = {
    "Record": {
        "Section": [
            {
                "Section": [
                    {
                        "TOCHeading": "GHS Classification",
                        "Information": [
                            {
                                "Name": "GHS Hazard Statements",
                                "Value": {
                                    "StringWithMarkup": [
                                        {"String": "H360 (100%): May damage fertility"},
                                        {"String": "H312: Harmful in contact with skin"},
                                        {"String": "H411: Toxic to aquatic life"},
                                        {"String": "H226: Flammable liquid and vapour"},
                                    ]
                                },
                            }
                        ],
                    }
                ]
            }
        ]
    }
}


class FakeClock:
    def __init__(self):
        self.value = 1_700_000_000.0
        self.sleeps: list[float] = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


class FakePubChemClient:
    def __init__(self, cid=702, ghs_payload=DMF_GHS, sequence=None, throttle="Request Count status: Green"):
        self.cid = cid
        self.ghs_payload = ghs_payload
        self.sequence = list(sequence or [])
        self.throttle = throttle
        self.requests: list[tuple[str, str | int]] = []

    def resolve_cid(self, solvent):
        self.requests.append(("resolve", solvent))
        return self._next(HttpResponse(200, {"X-Throttling-Control": self.throttle}, {"IdentifierList": {"CID": [self.cid]}}))

    def fetch_ghs(self, cid):
        self.requests.append(("ghs", cid))
        return self._next(HttpResponse(200, {"X-Throttling-Control": self.throttle}, self.ghs_payload))

    def _next(self, default):
        return self.sequence.pop(0) if self.sequence else default


def _store(tmp_path: Path) -> SolventEvidenceStore:
    path = tmp_path / "evidence.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO schema_metadata VALUES ('schema_version', '1');
            CREATE TABLE chem21 (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
                cas TEXT NOT NULL, pubchem_id INTEGER, safety INTEGER NOT NULL,
                health INTEGER NOT NULL, environment INTEGER NOT NULL, overall INTEGER NOT NULL,
                classification TEXT NOT NULL, replacements_json TEXT NOT NULL
            );
            CREATE TABLE chem21_aliases (normalized_alias TEXT PRIMARY KEY, chem21_id INTEGER NOT NULL);
            CREATE TABLE hazard_profiles (id INTEGER PRIMARY KEY, normalized_name TEXT NOT NULL, profile_json TEXT NOT NULL);
            INSERT INTO chem21 VALUES (1, 'N,N-Dimethylformamide', 'n,n-dimethylformamide',
                '68-12-2', NULL, 3, 9, 5, 9, 'hazardous', '[]');
            INSERT INTO chem21_aliases VALUES ('n,n-dimethylformamide', 1);
            INSERT INTO chem21_aliases VALUES ('dmf', 1);
            """
        )
    return SolventEvidenceStore(path)


def test_harvest_resumes_without_duplicate_requests_and_respects_two_second_pacing(tmp_path):
    store = _store(tmp_path)
    snapshots = tmp_path / "snapshots"
    clock = FakeClock()
    client = FakePubChemClient()

    report = harvest_hazards(store, client, snapshots, now=clock.now, sleep=clock.sleep)

    assert report.complete == 1
    assert report.requests == 2
    assert clock.sleeps == [2.0]
    profile = store.hazard_profile("DMF")
    assert profile is not None
    assert profile.cmr is True
    assert profile.acute is True
    assert profile.environmental is True
    assert profile.physical is True
    assert (snapshots / "702.json").is_file()
    manifest = json.loads((snapshots / "702.manifest.json").read_text(encoding="utf-8"))
    assert manifest["http_status"] == 200
    assert manifest["sha256"]

    resumed = harvest_hazards(store, client, snapshots, now=clock.now, sleep=clock.sleep)
    assert resumed.requests == 0
    assert len(client.requests) == 2


def test_harvest_records_terminal_not_found_and_backs_off_on_pubchem_throttle(tmp_path):
    store = _store(tmp_path)
    clock = FakeClock()
    client = FakePubChemClient(sequence=[HttpResponse(503, {}, None), HttpResponse(404, {}, None)])

    report = harvest_hazards(store, client, tmp_path / "snapshots", now=clock.now, sleep=clock.sleep)

    assert report.terminal_not_found == 1
    assert report.requests == 2
    assert clock.sleeps == [2.0]
    assert store.hazard_profile("DMF") is None


@pytest.mark.parametrize(("throttle", "expected_sleep"), [
    ("Request Count status: Yellow", 10.0),
    ("Request Count status: Red", 60.0),
])
def test_harvest_honors_pubchem_throttle_header(tmp_path, throttle, expected_sleep):
    store = _store(tmp_path)
    clock = FakeClock()

    harvest_hazards(store, FakePubChemClient(throttle=throttle), tmp_path / "snapshots", now=clock.now, sleep=clock.sleep)

    assert clock.sleeps == [expected_sleep]


def test_harvest_reclaims_a_stale_worker_lock(tmp_path):
    store = _store(tmp_path)
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()
    (snapshots / ".harvest.lock").write_text("defunct worker", encoding="utf-8")

    report = harvest_hazards(store, FakePubChemClient(), snapshots, now=lambda: 0.0, sleep=lambda _: None)

    assert report.complete == 1


def test_harvest_rejects_a_live_worker_lock(tmp_path):
    store = _store(tmp_path)
    snapshots = tmp_path / "snapshots"
    snapshots.mkdir()

    with _worker_lock(snapshots / ".harvest.lock"):
        with pytest.raises(HarvesterAlreadyRunningError):
            harvest_hazards(store, FakePubChemClient(), snapshots, now=lambda: 0.0, sleep=lambda _: None)




def test_harvest_fsyncs_snapshot_files_and_directory_before_checkpoint(tmp_path, monkeypatch):
    store = _store(tmp_path)
    synced: list[str] = []
    original_fsync = solvent_hazard_harvest.os.fsync

    def record_fsync(descriptor):
        mode = solvent_hazard_harvest.os.fstat(descriptor).st_mode
        synced.append("directory" if stat.S_ISDIR(mode) else "file")
        original_fsync(descriptor)

    monkeypatch.setattr(solvent_hazard_harvest.os, "fsync", record_fsync)
    harvest_hazards(store, FakePubChemClient(), tmp_path / "snapshots", now=lambda: 0.0, sleep=lambda _: None)

    assert synced.count("directory") == 2
    assert synced.count("file") >= 3


@pytest.mark.parametrize("code", ["H360FD", "H360Df"])
def test_harvest_classifies_h360_variants_as_cmr_and_health_hazards(tmp_path, code):
    store = _store(tmp_path)
    payload = json.loads(json.dumps(DMF_GHS))
    statements = payload["Record"]["Section"][0]["Section"][0]["Information"][0]["Value"]["StringWithMarkup"]
    statements[:] = [{"String": f"{code}: May damage fertility or the unborn child"}]

    harvest_hazards(store, FakePubChemClient(ghs_payload=payload), tmp_path / "snapshots", now=lambda: 0.0, sleep=lambda _: None)

    profile = store.hazard_profile("DMF")
    assert profile is not None
    assert profile.cmr is True
    assert profile.health is True
def test_harvest_targets_the_unified_solubility_solvent_identities(tmp_path):
    store = _store(tmp_path)
    with sqlite3.connect(store.path) as connection:
        connection.executescript(
            """
            CREATE TABLE single_solubility (solvent TEXT NOT NULL, normalized_solvent TEXT NOT NULL);
            CREATE TABLE mixture_solubility (
                solvent_1 TEXT NOT NULL, normalized_solvent_1 TEXT NOT NULL,
                solvent_2 TEXT NOT NULL, normalized_solvent_2 TEXT NOT NULL
            );
            INSERT INTO single_solubility VALUES ('ethanol', 'ethanol');
            INSERT INTO mixture_solubility VALUES ('ethanol', 'ethanol', 'water', 'water');
            """
        )

    client = FakePubChemClient()
    harvest_hazards(store, client, tmp_path / "snapshots", now=lambda: 0.0, sleep=lambda _: None)

    assert [request for request in client.requests if request[0] == "resolve"] == [
        ("resolve", "ethanol"),
        ("resolve", "water"),
    ]


def test_harvest_completes_a_fetched_snapshot_without_refetching(tmp_path):
    store = _store(tmp_path)
    snapshots = tmp_path / "snapshots"
    clock = FakeClock()
    harvest_hazards(store, FakePubChemClient(), snapshots, now=clock.now, sleep=clock.sleep)
    with sqlite3.connect(store.path) as connection:
        connection.execute("DELETE FROM hazard_profiles")
        connection.execute(
            "UPDATE hazard_harvest_state SET state = 'ghs_fetched' WHERE normalized_name = ?",
            ("n,n-dimethylformamide",),
        )

    resumed = harvest_hazards(store, FakePubChemClient(), snapshots, now=clock.now, sleep=clock.sleep)

    assert resumed.requests == 0
    assert resumed.complete == 1
    assert store.hazard_profile("DMF") is not None


def test_harvest_uses_configured_minimum_request_interval(tmp_path):
    store = _store(tmp_path)
    clock = FakeClock()

    harvest_hazards(
        store,
        FakePubChemClient(),
        tmp_path / "snapshots",
        now=clock.now,
        sleep=clock.sleep,
        minimum_interval=7.0,
    )

    assert clock.sleeps == [7.0]


def test_urllib_client_converts_http_errors_to_response_statuses(monkeypatch):
    headers = Message()
    headers["X-Throttling-Control"] = "Request Count status: Red"

    def raise_not_found(*_args, **_kwargs):
        raise HTTPError("https://example.test", 404, "Not Found", headers, io.BytesIO(b"{}"))

    monkeypatch.setattr(solvent_hazard_harvest, "urlopen", raise_not_found)

    response = UrllibPubChemClient().resolve_cid("missing solvent")

    assert response.status == 404
    assert response.json == {}
    assert response.headers["X-Throttling-Control"] == "Request Count status: Red"


def test_hazard_profile_exposes_screening_category_levels(tmp_path):
    store = _store(tmp_path)
    harvest_hazards(store, FakePubChemClient(), tmp_path / "snapshots", now=lambda: 0.0, sleep=lambda _: None)

    profile = store.hazard_profile("DMF")

    assert profile is not None
    assert profile.category_levels() == {
        "cmr": 1,
        "acute": 1,
        "organ": 0,
        "environment": 1,
        "physical": 1,
    }
