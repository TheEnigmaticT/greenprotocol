"""Single-worker, resumable PubChem GHS snapshot harvester."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Callable, Iterator, Mapping, Protocol
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ghs import (
    ENVIRONMENTAL_HAZARD_CODES,
    HEALTH_HAZARD_CODES,
    PHYSICAL_HAZARD_CODES,
    is_cmr,
    parse_hcodes_with_details,
)


PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_VIEW_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
PARSER_VERSION = "1"
_LOCK_FILENAME = ".harvest.lock"
_TERMINAL_STATES = frozenset({"complete", "terminal_not_found"})


@dataclass(frozen=True)
class HttpResponse:
    """The minimal response shape required by the synchronous harvester."""

    status: int
    headers: Mapping[str, str]
    json: dict | None


@dataclass(frozen=True)
class HarvestReport:
    requests: int = 0
    complete: int = 0
    terminal_not_found: int = 0
    unresolved: int = 0
    cid_resolved: int = 0
    ghs_fetched: int = 0
    throttle: str | None = None


class PubChemClient(Protocol):
    def resolve_cid(self, solvent: str) -> HttpResponse: ...

    def fetch_ghs(self, cid: int) -> HttpResponse: ...


class HarvesterAlreadyRunningError(RuntimeError):
    """Raised when another worker holds the snapshot directory lock."""


class UrllibPubChemClient:
    """The real HTTP implementation; tests inject a client instead."""

    def resolve_cid(self, solvent: str) -> HttpResponse:
        return self._get(f"{PUBCHEM_BASE}/compound/name/{quote(solvent, safe='')}/cids/JSON")

    def fetch_ghs(self, cid: int) -> HttpResponse:
        return self._get(f"{PUBCHEM_VIEW_BASE}/{cid}/JSON?heading=GHS+Classification")

    @staticmethod
    def _get(url: str) -> HttpResponse:
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "GreenProtoCol/0.1"})
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed PubChem URLs above
                return HttpResponse(response.status, dict(response.headers.items()), _decode_json(response.read()))
        except HTTPError as error:
            return HttpResponse(error.code, dict(error.headers.items()), _decode_json(error.read()))


def harvest_hazards(
    store: object,
    client: PubChemClient,
    snapshot_dir: Path | str,
    now: Callable[[], float],
    sleep: Callable[[float], None],
    on_checkpoint: Callable[[str, HarvestReport], None] | None = None,
    minimum_interval: float = 2.0,
) -> HarvestReport:
    """Harvest each indexed solvent once, checkpointing every remote outcome."""
    if minimum_interval < 2.0:
        raise ValueError("minimum_interval must be at least two seconds")
    database_path = Path(getattr(store, "path"))
    snapshots = Path(snapshot_dir)
    snapshots.mkdir(parents=True, exist_ok=True)
    lock_path = snapshots / _LOCK_FILENAME
    with _worker_lock(lock_path):
        with sqlite3.connect(database_path) as connection:
            connection.row_factory = sqlite3.Row
            _create_harvest_tables(connection)
            candidates = _candidates(connection)
            report = HarvestReport()
            for index, candidate in enumerate(candidates):
                request_count = report.requests
                report = _harvest_candidate(
                    connection, candidate, client, snapshots, now, sleep, report, minimum_interval
                )
                if report.requests != request_count:
                    state = _state(connection, candidate["normalized_name"])
                    if on_checkpoint is not None and state is not None:
                        on_checkpoint(state["state"], report)
                    if index + 1 < len(candidates):
                        sleep(_throttle_interval(report.throttle, minimum_interval))
            return report


def _candidates(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if {"single_solubility", "mixture_solubility"} <= tables:
        return list(
            connection.execute(
                """SELECT MIN(name) AS name, normalized_name
                   FROM (
                       SELECT solvent AS name, normalized_solvent AS normalized_name
                       FROM single_solubility
                       UNION ALL
                       SELECT solvent_1 AS name, normalized_solvent_1 AS normalized_name
                       FROM mixture_solubility
                       UNION ALL
                       SELECT solvent_2 AS name, normalized_solvent_2 AS normalized_name
                       FROM mixture_solubility
                   )
                   GROUP BY normalized_name
                   ORDER BY normalized_name"""
            )
        )
    return list(connection.execute("SELECT name, normalized_name FROM chem21 ORDER BY id"))


def _harvest_candidate(
    connection: sqlite3.Connection,
    candidate: sqlite3.Row,
    client: PubChemClient,
    snapshots: Path,
    now: Callable[[], float],
    sleep: Callable[[float], None],
    report: HarvestReport,
    minimum_interval: float,
) -> HarvestReport:
    name = candidate["name"]
    normalized_name = candidate["normalized_name"]
    state = _state(connection, normalized_name)
    if state is not None and state["state"] in _TERMINAL_STATES:
        return report

    cid = state["cid"] if state is not None else None
    retry_attempt = state["retry_attempt"] if state is not None else 0
    if state is not None and state["state"] == "ghs_fetched" and cid is not None:
        persisted = _load_snapshot(snapshots, int(cid))
        if persisted is not None:
            payload, snapshot = persisted
            _store_profile(connection, normalized_name, name, int(cid), payload, snapshot)
            _checkpoint(
                connection, normalized_name, name, int(cid), "complete", 0,
                state["last_http_status"] or 200, now(),
            )
            return _with_state(report, "complete")
    if cid is None:
        response = client.resolve_cid(name)
        report = _with_request(report, response)
        if response.status == 200:
            cid = _cid_from(response.json)
            if cid is None:
                _checkpoint(connection, normalized_name, name, None, "terminal_not_found", 0, response.status, now())
                return _with_terminal(report)
            _checkpoint(connection, normalized_name, name, cid, "cid_resolved", 0, response.status, now())
            report = _with_state(report, "cid_resolved")
            _sleep_for_response(response, retry_attempt, sleep, minimum_interval)
        elif response.status in {429, 503}:
            retry_attempt += 1
            _checkpoint(connection, normalized_name, name, None, "unresolved", retry_attempt, response.status, now())
            sleep(_retry_delay(retry_attempt))
            return _harvest_candidate(
                connection, candidate, client, snapshots, now, sleep, report, minimum_interval
            )
        elif 400 <= response.status < 500:
            _checkpoint(connection, normalized_name, name, None, "terminal_not_found", retry_attempt, response.status, now())
            return _with_terminal(report)
        else:
            _checkpoint(connection, normalized_name, name, None, "unresolved", retry_attempt, response.status, now())
            return _with_state(report, "unresolved")

    response = client.fetch_ghs(int(cid))
    report = _with_request(report, response)
    if response.status == 200 and response.json is not None:
        snapshot = _persist_snapshot(snapshots, int(cid), response, now())
        _checkpoint(connection, normalized_name, name, int(cid), "ghs_fetched", 0, response.status, now())
        report = _with_state(report, "ghs_fetched")
        _store_profile(connection, normalized_name, name, int(cid), response.json, snapshot)
        _checkpoint(connection, normalized_name, name, int(cid), "complete", 0, response.status, now())
        report = _with_state(report, "complete")
        return report
    if response.status in {429, 503}:
        retry_attempt += 1
        _checkpoint(connection, normalized_name, name, int(cid), "cid_resolved", retry_attempt, response.status, now())
        sleep(_retry_delay(retry_attempt))
        return _harvest_candidate(
            connection, candidate, client, snapshots, now, sleep, report, minimum_interval
        )
    if 400 <= response.status < 500:
        _checkpoint(connection, normalized_name, name, int(cid), "terminal_not_found", retry_attempt, response.status, now())
        return _with_terminal(report)
    _checkpoint(connection, normalized_name, name, int(cid), "cid_resolved", retry_attempt, response.status, now())
    return _with_state(report, "cid_resolved")


def _create_harvest_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """CREATE TABLE IF NOT EXISTS hazard_harvest_state (
            normalized_name TEXT PRIMARY KEY,
            solvent_name TEXT NOT NULL,
            cid INTEGER,
            state TEXT NOT NULL CHECK(state IN (
                'unresolved', 'cid_resolved', 'ghs_fetched', 'complete', 'terminal_not_found'
            )),
            retry_attempt INTEGER NOT NULL DEFAULT 0,
            last_http_status INTEGER,
            updated_at TEXT NOT NULL
        )"""
    )
    connection.commit()


def _state(connection: sqlite3.Connection, normalized_name: str) -> sqlite3.Row | None:
    return connection.execute(
        """SELECT cid, state, retry_attempt, last_http_status
           FROM hazard_harvest_state WHERE normalized_name = ?""",
        (normalized_name,),
    ).fetchone()


def _checkpoint(
    connection: sqlite3.Connection,
    normalized_name: str,
    solvent_name: str,
    cid: int | None,
    state: str,
    retry_attempt: int,
    status: int,
    timestamp: float,
) -> None:
    connection.execute(
        """INSERT INTO hazard_harvest_state (
            normalized_name, solvent_name, cid, state, retry_attempt, last_http_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_name) DO UPDATE SET
            solvent_name = excluded.solvent_name, cid = excluded.cid, state = excluded.state,
            retry_attempt = excluded.retry_attempt, last_http_status = excluded.last_http_status,
            updated_at = excluded.updated_at""",
        (normalized_name, solvent_name, cid, state, retry_attempt, status, _timestamp(timestamp)),
    )
    connection.commit()


def _persist_snapshot(snapshots: Path, cid: int, response: HttpResponse, timestamp: float) -> dict[str, str]:
    snapshot_path = snapshots / f"{cid}.json"
    encoded = json.dumps(response.json, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    _atomic_write(snapshot_path, encoded)
    manifest = {
        "parser_version": PARSER_VERSION,
        "query_url": f"{PUBCHEM_VIEW_BASE}/{cid}/JSON?heading=GHS+Classification",
        "retrieved_at": _timestamp(timestamp),
        "http_status": response.status,
        "x_throttling_control": _header(response.headers, "X-Throttling-Control"),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "byte_size": len(encoded),
    }
    _atomic_write(snapshots / f"{cid}.manifest.json", json.dumps(manifest, sort_keys=True, indent=2).encode("utf-8") + b"\n")
    return {"path": snapshot_path.name, "sha256": manifest["sha256"], "retrieved_at": manifest["retrieved_at"]}


def _load_snapshot(snapshots: Path, cid: int) -> tuple[dict, dict[str, str]] | None:
    snapshot_path = snapshots / f"{cid}.json"
    manifest_path = snapshots / f"{cid}.manifest.json"
    try:
        content = snapshot_path.read_bytes()
        payload = json.loads(content)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(manifest, dict):
        return None
    if manifest.get("http_status") != 200 or manifest.get("sha256") != hashlib.sha256(content).hexdigest():
        return None
    retrieved_at = manifest.get("retrieved_at")
    if not isinstance(retrieved_at, str):
        return None
    return payload, {
        "path": snapshot_path.name,
        "sha256": manifest["sha256"],
        "retrieved_at": retrieved_at,
    }


def _store_profile(
    connection: sqlite3.Connection,
    normalized_name: str,
    solvent_name: str,
    cid: int,
    payload: dict,
    snapshot: dict[str, str],
) -> None:
    hcodes = parse_hcodes_with_details(payload)
    codes = [hazard["code"] for hazard in hcodes]
    category_codes = {_category_code(code) for code in codes}
    acute_codes = {"H300", "H301", "H302", "H303", "H310", "H311", "H312", "H313", "H330", "H331", "H332", "H333"}
    organ_codes = {"H370", "H371", "H372", "H373"}
    profile = {
        "solvent": solvent_name,
        "cid": cid,
        "hcodes": hcodes,
        "cmr": is_cmr(codes),
        "acute": bool(category_codes & acute_codes),
        "organ": bool(category_codes & organ_codes),
        "health": bool(category_codes & set(HEALTH_HAZARD_CODES)),
        "environmental": bool(category_codes & set(ENVIRONMENTAL_HAZARD_CODES)),
        "physical": bool(category_codes & set(PHYSICAL_HAZARD_CODES)),
        "source_url": f"{PUBCHEM_VIEW_BASE}/{cid}/JSON?heading=GHS+Classification",
        "snapshot": snapshot,
        "state": "complete",
    }
    connection.execute("DELETE FROM hazard_profiles WHERE normalized_name = ?", (normalized_name,))
    connection.execute(
        "INSERT INTO hazard_profiles (normalized_name, profile_json) VALUES (?, ?)",
        (normalized_name, json.dumps(profile, sort_keys=True)),
    )
    connection.commit()
def _category_code(code: str) -> str:
    normalized = code.upper()
    return "H360" if normalized.startswith("H360") else normalized


def _sleep_for_response(
    response: HttpResponse,
    retry_attempt: int,
    sleep: Callable[[float], None],
    minimum_interval: float,
) -> None:
    if response.status in {429, 503}:
        sleep(max(minimum_interval, _retry_delay(retry_attempt + 1)))
        return
    sleep(_throttle_interval(_header(response.headers, "X-Throttling-Control"), minimum_interval))


def _throttle_interval(throttle: str | None, minimum_interval: float) -> float:
    status = (throttle or "").casefold()
    if "red" in status:
        return 60.0
    if "yellow" in status:
        return 10.0
    return minimum_interval


def _retry_delay(retry_attempt: int) -> float:
    return float(min(300, 2 ** retry_attempt))


def _cid_from(payload: dict | None) -> int | None:
    try:
        value = payload["IdentifierList"]["CID"][0]  # type: ignore[index]
        return int(value)
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    target = name.casefold()
    return next((value for key, value in headers.items() if key.casefold() == target), None)

@contextmanager
def _worker_lock(path: Path) -> Iterator[None]:
    """Hold an advisory lock that the OS releases if the worker crashes."""
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise HarvesterAlreadyRunningError(f"hazard harvester is already running: {path}") from error
        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()))
        handle.flush()
        os.fsync(handle.fileno())
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _atomic_write(path: Path, content: bytes) -> None:
    """Durably publish one immutable artifact before its state checkpoint."""
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def _decode_json(content: bytes) -> dict | None:
    try:
        value = json.loads(content)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, UTC).isoformat().replace("+00:00", "Z")


def _with_request(report: HarvestReport, response: HttpResponse) -> HarvestReport:
    return HarvestReport(
        **{
            **report.__dict__,
            "requests": report.requests + 1,
            "throttle": _header(response.headers, "X-Throttling-Control"),
        }
    )


def _with_terminal(report: HarvestReport) -> HarvestReport:
    return HarvestReport(**{**report.__dict__, "terminal_not_found": report.terminal_not_found + 1})


def _with_state(report: HarvestReport, state: str) -> HarvestReport:
    return HarvestReport(**{**report.__dict__, state: getattr(report, state) + 1})
