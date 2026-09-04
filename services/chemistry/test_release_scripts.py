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


def test_production_deploy_refuses_a_missing_immutable_image_before_contacting_gcloud(tmp_path):
    fake_gcloud = tmp_path / "gcloud"
    fake_gcloud.write_text("#!/usr/bin/env bash\necho cloud-contacted >&2\nexit 99\n")
    fake_gcloud.chmod(0o755)

    result = run_script(
        DEPLOY_SCRIPT,
        {
            "DEPLOY_ENV": "production",
            "GIT_SHA": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
            ).strip(),
            "GITHUB_ACTIONS": "true",
            "RELEASE_AUTHORITY": "approved-production-release",
            "GCLOUD": str(fake_gcloud),
        },
    )

    assert result.returncode != 0
    assert "IMAGE_DIGEST is required" in result.stderr
    assert "cloud-contacted" not in result.stderr


def test_release_workflows_require_staging_validation_and_digest_promotion():
    workflow_dir = REPO_ROOT / ".github" / "workflows"
    candidate = (workflow_dir / "release-candidate.yml").read_text()
    production = (workflow_dir / "release-production.yml").read_text()

    assert "environment: staging" in candidate
    assert "staging-e2e" in candidate
    assert "staging-sentinel" in candidate
    assert "build-chemistry-image.sh" in candidate
    assert "IMAGE_DIGEST" in candidate
    assert "lfs: true" in production
    assert "resolve-chemistry-image.sh" in production
    assert "IMAGE_DIGEST" in production


def test_staging_deploy_uses_the_same_image_name_as_the_production_candidate():
    deploy = DEPLOY_SCRIPT.read_text()
    build = (REPO_ROOT / "scripts" / "build-chemistry-image.sh").read_text()

    assert 'CHEMISTRY_IMAGE_NAME="${CHEMISTRY_IMAGE_NAME:-greenchemistry-chemistry}"' in deploy
    assert 'CHEMISTRY_IMAGE_NAME="${CHEMISTRY_IMAGE_NAME:-greenchemistry-chemistry}"' in build


def test_deploy_uses_an_environment_specific_runtime_service_account():
    deploy = DEPLOY_SCRIPT.read_text()

    assert 'RUNTIME_SERVICE_ACCOUNT="${STAGING_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-gcai-staging-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"' in deploy
    assert 'RUNTIME_SERVICE_ACCOUNT="${PRODUCTION_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-greenchemistry-chemservice@${PROJECT_ID}.iam.gserviceaccount.com}"' in deploy
    assert '--service-account "$RUNTIME_SERVICE_ACCOUNT"' in deploy


def test_staging_defaults_to_zero_min_instances_without_changing_production_default():
    deploy = DEPLOY_SCRIPT.read_text()

    assert 'MIN_INSTANCES="${STAGING_MIN_INSTANCES:-0}"' in deploy
    assert 'MIN_INSTANCES="${PRODUCTION_MIN_INSTANCES:-1}"' in deploy
    assert '--min-instances "$MIN_INSTANCES"' in deploy


def test_obsolete_comment_only_ci_workflow_is_not_present():
    assert not (REPO_ROOT / ".github" / "workflows" / "ci-cd.yml").exists()
