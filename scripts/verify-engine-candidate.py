#!/usr/bin/env python3
"""Verify real direct-engine artifacts, not chemistry prediction accuracy."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {'fixture-1', 'fixture-2', 'fixture-3', 'suzuki', 'aspirin-demo'}


def verify(directory):
    directory = Path(directory)
    result = json.loads((directory / 'result.json').read_text())
    manifest = json.loads((directory / 'manifest.json').read_text())
    summary = json.loads((directory / 'summary.json').read_text())
    progress = json.loads((directory / 'progress.json').read_text())
    case = manifest['caseId']
    fixture = json.loads((ROOT / 'benchmarks' / 'engine-candidate' / f'{case}.json').read_text())
    fingerprint = hashlib.sha256(fixture['protocolText'].encode()).hexdigest()
    assert fingerprint == manifest['protocolSha256'] == fixture['provenance']['sourceProtocolSha256']
    original = Path(fixture['provenance']['sourcePath'])
    if original.exists():
        assert hashlib.sha256(original.read_bytes()).hexdigest() == fixture['provenance']['sourceFileSha256']
    assert result['steps'] and result['revisedProtocol'].strip()
    assert not (directory / 'failure.json').exists()
    terminal = {event['number']: event['status'] for event in progress
                if event.get('type') == 'principle' and event.get('status') in {'complete', 'failed'}}
    assert set(terminal) == set(range(1, 13)), 'Every principle requires a terminal outcome'
    assert any(value == 'complete' for value in terminal.values())
    scores = result['deterministicScores']['scores']
    assert {score['principle_number'] for score in scores} == set(range(1, 13))
    receipts = [json.loads(path.read_text()) for path in sorted(directory.glob('call-*.json'))]
    model_url = manifest['candidate']['model']['baseURL'] + '/chat/completions'
    model = manifest['candidate']['model']['model']
    chat = [receipt for receipt in receipts if receipt['endpoint'] == model_url]
    assert chat and all(receipt['request']['model'] == model for receipt in chat)
    assert chat[0]['request']['messages'][1]['content'] == fixture['protocolText']
    score_calls = [receipt for receipt in receipts if receipt['endpoint'].endswith(':8007/score')]
    assert len(score_calls) == 1 and score_calls[0]['status'] == 200
    assert score_calls[0]['request']['protocol_text'] == fixture['protocolText']
    destinations = sorted({receipt['endpoint'] for receipt in receipts})
    allowed = {model_url, 'http://127.0.0.1:8007/health', 'http://127.0.0.1:8007/batch', 'http://127.0.0.1:8007/score'}
    research = manifest['candidate']['research']
    if research['status'] == 'configured':
        allowed.update([research['evidenceRpcURL'], research['embedding']['baseURL'] + '/embeddings'])
    assert set(destinations) <= allowed
    return {
        'case': case, 'verifiedRuntimeResult': True, 'output': str(directory.resolve()),
        'protocolSha256': fingerprint, 'seconds': round(summary['elapsedMs'] / 1000, 1),
        'principlesCompleted': sum(value == 'complete' for value in terminal.values()),
        'principlesFailed': sum(value == 'failed' for value in terminal.values()),
        'recommendations': len(result['recommendations']),
        'scoresAvailable': sum(score['score'] >= 0 and score['confidence'] != 'unavailable' for score in scores),
        'revisedProtocolCharacters': len(result['revisedProtocol']),
        'reaction': result['deterministicScores'].get('smiles_extraction'),
        'chemistry': result.get('chemistryDataStatus'), 'research': summary['research'],
        'destinations': destinations,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', nargs='+')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    rows = [verify(directory) for directory in args.directories]
    assert len(rows) == len(EXPECTED) and {row['case'] for row in rows} == EXPECTED, 'Exactly the five distinct established fixtures are required'
    report = {'verifiedCases': len(rows), 'scope': 'runtime completion, not scientific accuracy or authenticated application persistence',
              'cases': sorted(rows, key=lambda row: row['case'])}
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
