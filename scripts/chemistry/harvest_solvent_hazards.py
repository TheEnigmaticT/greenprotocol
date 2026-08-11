#!/usr/bin/env python3
"""Run the single-instance PubChem GHS snapshot harvester."""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "chemistry"))

from solvent_evidence_store import SolventEvidenceStore
from solvent_hazard_harvest import UrllibPubChemClient, harvest_hazards


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--snapshots", required=True, type=Path)
    parser.add_argument("--interval-seconds", type=float, default=2.0)
    args = parser.parse_args()
    if args.interval_seconds < 2.0:
        parser.error("--interval-seconds must be at least 2")

    store = SolventEvidenceStore(args.database)
    signal.signal(signal.SIGTERM, _stop_cleanly)
    print(f"Harvest started: 239 planned catalogue targets; pacing at {args.interval_seconds:.1f} seconds", flush=True)

    def checkpoint(state, report) -> None:
        throttle = report.throttle or "not supplied"
        print(
            f"Harvest checkpoint: state={state} requests={report.requests} throttle={throttle}",
            flush=True,
        )

    report = harvest_hazards(
        store,
        UrllibPubChemClient(),
        args.snapshots,
        now=time.time,
        sleep=time.sleep,
        on_checkpoint=checkpoint,
        minimum_interval=args.interval_seconds,
    )
    print(
        f"Harvest finished: requests={report.requests} complete={report.complete} "
        f"terminal_not_found={report.terminal_not_found} throttle={report.throttle or 'not supplied'}",
        flush=True,
    )

def _stop_cleanly(_signal, _frame) -> None:
    """Unwind through the harvester so its filesystem lock is released."""
    raise SystemExit(0)


if __name__ == "__main__":
    main()
