import pytest
from scoring.p6_energy_efficiency import _parse_temp, score_p6


@pytest.mark.parametrize("value,expected", [
    ("77°F", (77 - 32) * 5 / 9),
    ("293.15 K", 293.15 - 273.15),
    ("68–86 °F", (((68 + 86) / 2) - 32) * 5 / 9),
    ("-78°C", -78),
    ("75-80°C", (75 + 80) / 2),
])
def test_temperature_units_are_respected(value, expected):
    assert _parse_temp(value) == pytest.approx(expected)


@pytest.mark.parametrize("value", ["25", "reflux for 2 hours", 80, "-300°C"])
def test_missing_units_or_invalid_temperature_do_not_become_celsius(value):
    assert _parse_temp(value) is None


def test_null_conditions_do_not_crash_scoring():
    result = score_p6([{"stepNumber": 1, "conditions": None}])
    assert result.score == -1


def test_temperature_proxy_is_not_presented_as_measured_energy():
    result = score_p6([{"stepNumber": 1, "conditions": {"temperature": "80°C"}}])
    assert "proxy" in result.details["methodology_note"].lower()
    assert "not measured energy" in result.details["methodology_note"].lower()
