#!/usr/bin/env python3
"""Loopback-only chemistry service launcher for one engine-candidate probe.

This launcher does not load dotenv files. It uses only inherited runtime
configuration, removes Supabase configuration before importing the service, and
allows service httpx traffic only to the selected model chat endpoint or public
PubChem GET data endpoints.

Live use (do not run this as a preflight):
  uv run --with-requirements services/chemistry/requirements.txt \
    python scripts/run-engine-chemistry.py --output /absolute/new/chemistry-output
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

OPENROUTER_V1 = "https://openrouter.ai/api/v1"
PUBCHEM_HOST = "pubchem.ncbi.nlm.nih.gov"
HOST = "127.0.0.1"
PORT = 8007
ROOT = Path(__file__).resolve().parent.parent
CHEMISTRY_SOURCE = ROOT / "services" / "chemistry"
SENSITIVE_KEY_MARKERS = ("authorization", "api_key", "apikey", "token", "secret", "password", "cookie")


@dataclass(frozen=True)
class CandidateConfig:
    base_url: str
    model: str
    api_key: str
    api_key_source: str
    chemistry_token: str


def configured_value(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def require_value(name: str) -> str:
    value = configured_value(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


def parse_versioned_base_url(value: str, name: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith("/v1")
    ):
        raise ValueError(f"{name} must be an absolute http(s) URL ending in /v1")
    return value.rstrip("/")


def resolve_config() -> CandidateConfig:
    if os.environ.get("GCAI_ENGINE_CANDIDATE") != "1":
        raise ValueError("GCAI_ENGINE_CANDIDATE=1 is required")
    base_url = parse_versioned_base_url(require_value("GCAI_LLM_BASE_URL"), "GCAI_LLM_BASE_URL")
    model = require_value("GCAI_LLM_MODEL")
    explicit_key = configured_value("GCAI_LLM_API_KEY")
    fallback_key = configured_value("OPENROUTER_API_KEY") if base_url == OPENROUTER_V1 else None
    api_key = explicit_key or fallback_key
    if not api_key:
        raise ValueError("GCAI_LLM_API_KEY is required for a non-OpenRouter candidate endpoint")
    return CandidateConfig(
        base_url=base_url,
        model=model,
        api_key=api_key,
        api_key_source="explicit" if explicit_key else "openrouter-fallback",
        chemistry_token=require_value("CHEMISTRY_SERVICE_TOKEN"),
    )


def redacted(value: Any, secrets: tuple[str, ...]) -> Any:
    if isinstance(value, str):
        safe = value
        for secret in secrets:
            if secret:
                safe = safe.replace(secret, "[REDACTED]")
        return safe
    if isinstance(value, list):
        return [redacted(item, secrets) for item in value]
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if any(marker in key.lower() for marker in SENSITIVE_KEY_MARKERS)
            else redacted(nested, secrets)
            for key, nested in value.items()
        }
    return value


def write_json(path: Path, value: Any, secrets: tuple[str, ...]) -> None:
    encoded = (json.dumps(redacted(value, secrets), indent=2, sort_keys=True) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
    except BaseException:
        os.close(descriptor)
        raise


class ReceiptWriter:
    def __init__(self, output: Path, secrets: tuple[str, ...]) -> None:
        self.output = output
        self.secrets = secrets
        self.count = 0

    def save(self, receipt: dict[str, Any]) -> None:
        write_json(self.output / f"python-call-{receipt['id']:03d}.json", receipt, self.secrets)

    def new(self, method: str, url: str, request_json: Any) -> dict[str, Any]:
        self.count += 1
        parsed = urlparse(url)
        receipt = {
            "id": self.count,
            "endpoint": f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
            "method": method.upper(),
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "request": request_json,
        }
        self.save(receipt)
        return receipt


def same_endpoint(url: str, expected: str) -> bool:
    parsed = urlparse(url)
    target = urlparse(expected)
    return (
        parsed.scheme == target.scheme
        and parsed.hostname == target.hostname
        and parsed.port == target.port
        and parsed.path == target.path
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and not parsed.username
        and not parsed.password
    )


def allowed_pubchem_get(method: str, url: str) -> bool:
    parsed = urlparse(url)
    return (
        method.upper() == "GET"
        and parsed.scheme == "https"
        and parsed.hostname == PUBCHEM_HOST
        and parsed.port in {None, 443}
        and not parsed.username
        and not parsed.password
        and (parsed.path.startswith("/rest/pug/") or parsed.path.startswith("/rest/pug_view/"))
    )


def allowed_request(config: CandidateConfig, method: str, url: str, request_json: Any) -> bool:
    if allowed_pubchem_get(method, url):
        return True
    return (
        method.upper() == "POST"
        and same_endpoint(url, f"{config.base_url}/chat/completions")
        and isinstance(request_json, dict)
        and request_json.get("model") == config.model
    )


def safe_raw_response(response: httpx.Response) -> str | None:
    content_type = response.headers.get("content-type", "").lower()
    if not ("json" in content_type or content_type.startswith("text/")):
        return None
    try:
        return response.text
    except (httpx.HTTPError, UnicodeDecodeError):
        return None


def install_httpx_allowlist(config: CandidateConfig, receipts: ReceiptWriter) -> None:
    original_async_client = httpx.AsyncClient
    original_client = httpx.Client

    async def guarded_async_request(client: httpx.AsyncClient, method: str, url: Any, **kwargs: Any) -> httpx.Response:
        rendered_url = str(url)
        request_json = kwargs.get("json")
        receipt = receipts.new(method, rendered_url, request_json)
        if not allowed_request(config, method, rendered_url, request_json):
            receipt["error"] = "candidate_httpx_destination_blocked"
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            raise httpx.RequestError("Candidate httpx destination blocked", request=httpx.Request(method, rendered_url))
        try:
            response = await super(GuardedAsyncClient, client).request(method, url, **kwargs)
            receipt["status"] = response.status_code
            raw_response = safe_raw_response(response)
            if raw_response is not None:
                receipt["rawResponse"] = raw_response
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            return response
        except BaseException as error:
            receipt["error"] = type(error).__name__
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            raise

    def guarded_sync_request(client: httpx.Client, method: str, url: Any, **kwargs: Any) -> httpx.Response:
        rendered_url = str(url)
        request_json = kwargs.get("json")
        receipt = receipts.new(method, rendered_url, request_json)
        if not allowed_request(config, method, rendered_url, request_json):
            receipt["error"] = "candidate_httpx_destination_blocked"
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            raise httpx.RequestError("Candidate httpx destination blocked", request=httpx.Request(method, rendered_url))
        try:
            response = super(GuardedClient, client).request(method, url, **kwargs)
            receipt["status"] = response.status_code
            raw_response = safe_raw_response(response)
            if raw_response is not None:
                receipt["rawResponse"] = raw_response
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            return response
        except BaseException as error:
            receipt["error"] = type(error).__name__
            receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
            receipts.save(receipt)
            raise

    class GuardedAsyncClient(original_async_client):
        async def request(self, method: str, url: Any, **kwargs: Any) -> httpx.Response:
            return await guarded_async_request(self, method, url, **kwargs)

    class GuardedClient(original_client):
        def request(self, method: str, url: Any, **kwargs: Any) -> httpx.Response:
            return guarded_sync_request(self, method, url, **kwargs)

    httpx.AsyncClient = GuardedAsyncClient  # type: ignore[assignment]
    httpx.Client = GuardedClient  # type: ignore[assignment]


def strip_supabase_configuration() -> list[str]:
    stripped: list[str] = []
    for name in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ):
        if name in os.environ:
            os.environ.pop(name, None)
            stripped.append(name)
    return stripped


def prepare_output(path_value: str) -> Path:
    output = Path(path_value).expanduser().resolve()
    if not output.is_absolute():
        raise ValueError("--output must be an absolute path")
    if output.exists():
        raise ValueError("--output must not already exist; use a unique output directory")
    output.mkdir(mode=0o700, parents=False)
    return output


def manifest(config: CandidateConfig, cache_dir: Path, stripped: list[str]) -> dict[str, Any]:
    return {
        "launcher": "engine-candidate-loopback-chemistry",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "listen": f"http://{HOST}:{PORT}",
        "candidate": {
            "flag": True,
            "model": config.model,
            "baseURL": config.base_url,
            "apiKeySource": config.api_key_source,
            "chemistryTokenConfigured": True,
        },
        "cacheDir": str(cache_dir),
        "supabase": {
            "status": "disabled",
            "strippedEnvironmentNames": stripped,
            "referenceStoreWrites": "disabled_by_missing_runtime_configuration",
        },
        "httpxAllowlist": {
            "model": f"POST {config.base_url}/chat/completions with the selected model only",
            "pubchem": "GET https://pubchem.ncbi.nlm.nih.gov/rest/pug/* or /rest/pug_view/* only",
        },
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start isolated loopback chemistry service for a candidate engine probe.")
    parser.add_argument("--output", help="New absolute directory for manifest, receipts, and isolated cache")
    parser.add_argument("--preflight", action="store_true", help="Validate inherited candidate settings without importing or starting the service")
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args(sys.argv[1:])
    try:
        config = resolve_config()
        if args.preflight:
            print(json.dumps({
                "ok": True,
                "mode": "preflight",
                "listen": f"http://{HOST}:{PORT}",
                "supabase": "will_be_stripped",
                "httpx": "model_chat_and_pubchem_get_only",
            }))
            return 0
        if not args.output:
            raise ValueError("--output is required unless --preflight is used")

        output = prepare_output(args.output)
        cache_dir = output / "cache"
        cache_dir.mkdir(mode=0o700)
        stripped = strip_supabase_configuration()
        os.environ["CACHE_DIR"] = str(cache_dir)
        os.environ.pop("CHEMISTRY_SERVICE_ALLOW_ANONYMOUS", None)
        os.environ.pop("GCAI_QWEN_PARITY", None)
        os.environ.pop("ANTHROPIC_API_KEY", None)
        os.environ.pop("OPENAI_API_KEY", None)
        os.environ.pop("LOCAL_LLM_URL", None)
        os.environ.pop("LLM_PROVIDER", None)

        receipts = ReceiptWriter(output, (config.api_key, config.chemistry_token))
        write_json(output / "manifest.json", manifest(config, cache_dir, stripped), receipts.secrets)
        install_httpx_allowlist(config, receipts)
        sys.path.insert(0, str(CHEMISTRY_SOURCE))

        import uvicorn
        from main import app

        uvicorn.run(app, host=HOST, port=PORT, log_level="info", access_log=False)
        return 0
    except (ValueError, OSError) as error:
        print(json.dumps({"ok": False, "error": type(error).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
