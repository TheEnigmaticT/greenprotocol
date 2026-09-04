"""Release scripts must fail closed before invoking cloud tooling."""

from pathlib import Path
import os
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-chemistry-cloud-run.sh"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify-chemistry-release.sh"


def run_script(script: Path, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("DEPLOY_ENV", None)
    env.pop("GIT_SHA", None)
    env.update(extra_env or {})
    return subprocess.run(
        ["bash", str(script)],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_deploy_refuses_an_ambiguous_environment_before_contacting_gcloud():
    result = run_script(DEPLOY_SCRIPT)

    assert result.returncode != 0
    assert "DEPLOY_ENV is required" in result.stderr
    assert "gcloud" not in result.stdout.lower()


def test_deploy_refuses_a_missing_release_sha_before_contacting_gcloud():
    result = run_script(DEPLOY_SCRIPT, {"DEPLOY_ENV": "staging"})

    assert result.returncode != 0
    assert "GIT_SHA is required" in result.stderr
    assert "gcloud" not in result.stdout.lower()


def test_deploy_refuses_a_non_current_release_sha_before_contacting_gcloud():
    result = run_script(
        DEPLOY_SCRIPT,
        {"DEPLOY_ENV": "staging", "GIT_SHA": "0" * 40},
    )

    assert result.returncode != 0
    assert "does not match checked-out HEAD" in result.stderr
    assert "gcloud" not in result.stdout.lower()


def test_verifier_refuses_an_ambiguous_environment_before_contacting_gcloud():
    result = run_script(VERIFY_SCRIPT)

    assert result.returncode != 0
    assert "DEPLOY_ENV is required" in result.stderr
    assert "gcloud" not in result.stdout.lower()
