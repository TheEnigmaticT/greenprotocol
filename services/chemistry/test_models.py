"""Request-model regressions for persisted analyses."""

from models import BatchRequest


def test_batch_request_normalizes_a_persisted_null_quantity_to_empty_string():
    """A saved analysis may predate quantity extraction and hold null."""
    request = BatchRequest.model_validate({
        "chemicals": [{"chemical_name": "sodium sulfate", "quantity": None}],
    })

    assert request.chemicals[0].quantity == ""
