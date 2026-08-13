"""Tests for the chemistry service's fail-closed token auth.

Guards the regression where require_service_token no-oped when
CHEMISTRY_SERVICE_TOKEN was unset, leaving /batch, /score, and
/assistant-tools publicly callable (the shape of the July 2026 incident).
See docs/audits/2026-08-13-full-audit.md (High: fail-open auth).
"""

import pytest
from fastapi import HTTPException

import main


def test_rejects_wrong_token_when_configured(monkeypatch):
    monkeypatch.setenv("CHEMISTRY_SERVICE_TOKEN", "s3cret")
    with pytest.raises(HTTPException) as exc:
        main.require_service_token(x_chemistry_service_token="wrong")
    assert exc.value.status_code == 401


def test_accepts_correct_token_when_configured(monkeypatch):
    monkeypatch.setenv("CHEMISTRY_SERVICE_TOKEN", "s3cret")
    # No exception == authorized.
    assert main.require_service_token(x_chemistry_service_token="s3cret") is None


def test_fails_closed_when_token_unset_and_not_anonymous(monkeypatch):
    monkeypatch.delenv("CHEMISTRY_SERVICE_TOKEN", raising=False)
    monkeypatch.setattr(main, "ALLOW_ANONYMOUS", False)
    with pytest.raises(HTTPException) as exc:
        main.require_service_token(x_chemistry_service_token=None)
    assert exc.value.status_code == 503


def test_allows_anonymous_only_with_explicit_optin(monkeypatch):
    monkeypatch.delenv("CHEMISTRY_SERVICE_TOKEN", raising=False)
    monkeypatch.setattr(main, "ALLOW_ANONYMOUS", True)
    assert main.require_service_token(x_chemistry_service_token=None) is None
