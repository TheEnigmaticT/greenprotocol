from scoring.p2_atom_economy import score_p2
from scoring.models import ScoreProvenance


def test_p2_unbalanced_reaction_returns_benchmark_provenance() -> None:
    score = score_p2("CCO>>CC")

    assert score.confidence is ScoreProvenance.BENCHMARK
    assert score.details["balanced"] is False
