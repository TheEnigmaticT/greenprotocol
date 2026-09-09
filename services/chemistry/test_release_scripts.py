"""Release scripts must fail closed before invoking cloud tooling."""

from pathlib import Path
import json
import os
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / "scripts" / "deploy-chemistry-cloud-run.sh"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify-chemistry-release.sh"


def run_script(script: Path, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    for key in (
        "DEPLOY_ENV",
        "GIT_SHA",
        "IMAGE_DIGEST",
        "STAGING_ENGINE_CANDIDATE",
        "STAGING_OPENROUTER_MODEL",
        "STAGING_OPENROUTER_BASE_URL",
        "STAGING_CHEMISTRY_SERVICE_TOKEN",
    ):
        env.pop(key, None)
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
    assert "set -o pipefail" in candidate
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


def release_sha() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
    ).strip()


def install_fake_gcloud(tmp_path: Path) -> tuple[Path, Path]:
    fake_gcloud = tmp_path / "gcloud"
    log = tmp_path / "gcloud.log"
    fake_gcloud.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
if [[ "$*" == *"--set-env-vars"* && "$*" == *"--remove-env-vars"* ]]; then
  printf '%s\\n' "--set-env-vars and --remove-env-vars are mutually exclusive" >&2
  exit 64
fi
if [[ "$1 $2 $3" == "run services describe" ]]; then
  case " $* " in
    *" --format=json "*) printf '%s\\n' "${FAKE_GCLOUD_JSON:?}" ;;
    *"value(status.latestReadyRevisionName)"*) printf 'gcai-test-revision\\n' ;;
    *"value(status.url)"*) printf 'https://gcai.example.test\\n' ;;
  esac
fi
"""
    )
    fake_gcloud.chmod(0o755)
    return fake_gcloud, log


def install_fake_curl(tmp_path: Path) -> tuple[Path, Path]:
    fake_curl = tmp_path / "curl"
    log = tmp_path / "curl.log"
    fake_curl.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
if [[ "$*" == *"/batch"* ]]; then
  printf '%s\\n' '{"results":[{"chemical_name":"ethanol"}]}'
fi
"""
    )
    fake_curl.chmod(0o755)
    return fake_curl, log


def staged_service_json(
    *,
    runtime_env: dict[str, str] | None = None,
    secret_names: dict[str, str] | None = None,
) -> str:
    secrets = {
        "CHEMISTRY_SERVICE_TOKEN": "staging-chemistry-service-token",
        "SUPABASE_URL": "staging-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "staging-supabase-service-role-key",
        "OPENROUTER_API_KEY": "staging-greenchemistry-openrouter-api-key",
    }
    secrets.update(secret_names or {})
    env = [
        {"name": name, "valueFrom": {"secretKeyRef": {"name": secret}}}
        for name, secret in secrets.items()
    ]
    env.extend({"name": name, "value": value} for name, value in (runtime_env or {}).items())
    return json.dumps(
        {
            "status": {
                "traffic": [{"percent": 100, "revisionName": "gcai-test-revision"}],
                "url": "https://gcai.example.test",
            },
            "spec": {
                "template": {
                    "metadata": {"labels": {"release-sha": release_sha(), "deploy-env": "staging"}},
                    "spec": {
                        "serviceAccountName": "gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com",
                        "containers": [{"env": env}],
                    },
                }
            },
        }
    )


def test_staging_default_deploy_replaces_candidate_runtime_vars_with_set_env_vars_only(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)

    result = run_script(
        DEPLOY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "IMAGE_DIGEST": "sha256:" + "d" * 64,
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
        },
    )

    assert result.returncode == 0, result.stderr
    deploy = log.read_text()
    assert "--set-env-vars OPENROUTER_MODEL=anthropic/claude-sonnet-4.5" in deploy
    assert "--remove-env-vars" not in deploy
    assert "GCAI_ENGINE_CANDIDATE" not in deploy
    assert "GCAI_LLM_BASE_URL" not in deploy
    assert "GCAI_LLM_MODEL" not in deploy


def test_staging_candidate_deploy_binds_the_openrouter_and_gcai_runtime_flags(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)

    result = run_script(
        DEPLOY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "IMAGE_DIGEST": "sha256:" + "a" * 64,
            "STAGING_ENGINE_CANDIDATE": "1",
            "STAGING_OPENROUTER_MODEL": "qwen/qwen3.8-27b",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
        },
    )

    assert result.returncode == 0, result.stderr
    deploy = log.read_text()
    assert "run deploy gcai-chemistry" in deploy
    assert "OPENROUTER_MODEL=qwen/qwen3.8-27b" in deploy
    assert "GCAI_ENGINE_CANDIDATE=1" in deploy
    assert "GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1" in deploy
    assert "GCAI_LLM_MODEL=qwen/qwen3.8-27b" in deploy
    assert "--remove-env-vars" not in deploy


def test_production_deploy_keeps_the_legacy_model_without_candidate_runtime_flags(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)

    result = run_script(
        DEPLOY_SCRIPT,
        {
            "DEPLOY_ENV": "production",
            "GIT_SHA": release_sha(),
            "IMAGE_DIGEST": "sha256:" + "b" * 64,
            "GITHUB_ACTIONS": "true",
            "RELEASE_AUTHORITY": "approved-production-release",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
        },
    )

    assert result.returncode == 0, result.stderr
    deploy = log.read_text()
    assert "run deploy greenchemistry-chemistry" in deploy
    assert "OPENROUTER_MODEL=anthropic/claude-sonnet-4.5" in deploy
    assert "GCAI_ENGINE_CANDIDATE" not in deploy
    assert "GCAI_LLM_BASE_URL" not in deploy
    assert "GCAI_LLM_MODEL" not in deploy


def test_deploy_rejects_an_invalid_staging_candidate_flag_before_contacting_gcloud(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)

    result = run_script(
        DEPLOY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "IMAGE_DIGEST": "sha256:" + "c" * 64,
            "STAGING_ENGINE_CANDIDATE": "enabled",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
        },
    )

    assert result.returncode != 0
    assert "STAGING_ENGINE_CANDIDATE must be 1 or unset" in result.stderr
    assert not log.exists()


def test_staging_verifier_rejects_missing_candidate_runtime_config(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)
    install_fake_curl(tmp_path)
    service_json = staged_service_json(
        runtime_env={
            "OPENROUTER_MODEL": "qwen/qwen3.8-27b",
            "GCAI_ENGINE_CANDIDATE": "0",
            "GCAI_LLM_BASE_URL": "https://openrouter.ai/api/v1",
            "GCAI_LLM_MODEL": "qwen/qwen3.8-27b",
        }
    )

    result = run_script(
        VERIFY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "STAGING_CHEMISTRY_SERVICE_TOKEN": "test-token",
            "STAGING_ENGINE_CANDIDATE": "1",
            "STAGING_OPENROUTER_MODEL": "qwen/qwen3.8-27b",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
            "FAKE_GCLOUD_JSON": service_json,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "FAKE_CURL_LOG": str(tmp_path / "curl.log"),
        },
    )

    assert result.returncode != 0
    assert "Candidate runtime binding GCAI_ENGINE_CANDIDATE does not match" in result.stderr


def test_staging_verifier_rejects_a_production_provider_secret_binding(tmp_path):
    fake_gcloud, log = install_fake_gcloud(tmp_path)
    install_fake_curl(tmp_path)
    service_json = staged_service_json(
        secret_names={"OPENROUTER_API_KEY": "greenchemistry-openrouter-api-key"}
    )

    result = run_script(
        VERIFY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "STAGING_CHEMISTRY_SERVICE_TOKEN": "test-token",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(log),
            "FAKE_GCLOUD_JSON": service_json,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "FAKE_CURL_LOG": str(tmp_path / "curl.log"),
        },
    )

    assert result.returncode != 0
    assert "Cloud Run secret bindings do not match the selected staging environment" in result.stderr


def test_staging_verifier_accepts_the_requested_candidate_runtime_config(tmp_path):
    fake_gcloud, gcloud_log = install_fake_gcloud(tmp_path)
    _, curl_log = install_fake_curl(tmp_path)
    service_json = staged_service_json(
        runtime_env={
            "OPENROUTER_MODEL": "qwen/qwen3.8-27b",
            "GCAI_ENGINE_CANDIDATE": "1",
            "GCAI_LLM_BASE_URL": "https://openrouter.ai/api/v1",
            "GCAI_LLM_MODEL": "qwen/qwen3.8-27b",
        }
    )

    result = run_script(
        VERIFY_SCRIPT,
        {
            "DEPLOY_ENV": "staging",
            "GIT_SHA": release_sha(),
            "STAGING_CHEMISTRY_SERVICE_TOKEN": "test-token",
            "STAGING_ENGINE_CANDIDATE": "1",
            "STAGING_OPENROUTER_MODEL": "qwen/qwen3.8-27b",
            "GCLOUD": str(fake_gcloud),
            "FAKE_GCLOUD_LOG": str(gcloud_log),
            "FAKE_GCLOUD_JSON": service_json,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "FAKE_CURL_LOG": str(curl_log),
        },
    )

    assert result.returncode == 0, result.stderr
    assert "health=ok" in result.stdout
    assert "batch_sentinel=ok" in result.stdout
    assert "/health" in curl_log.read_text()
    assert "/batch" in curl_log.read_text()


def test_staging_dispatch_workflow_requires_main_ci_and_candidate_release_contract():
    workflow = (REPO_ROOT / ".github" / "workflows" / "deploy-staging.yml").read_text()

    assert "workflow_dispatch:" in workflow
    assert "\n  push:" not in workflow
    assert "\n  pull_request:" not in workflow
    assert "contents: read" in workflow
    assert "actions: read" in workflow
    assert "\n  group: staging-dispatch\n" in workflow
    assert "staging-dispatch-${{ github.sha }}" not in workflow
    assert "github.ref == 'refs/heads/main'" in workflow
    assert "exit 1" in workflow
    assert 'run.event === "push"' in workflow
    assert 'run.head_sha === context.sha' in workflow
    assert 'run.conclusion === "success"' in workflow
    assert 'run.path === ".github/workflows/ci.yml"' in workflow
    assert "environment: staging" in workflow
    assert "ref: ${{ github.sha }}" in workflow
    assert "lfs: true" in workflow
    assert "GCP_STAGING_RELEASE_CREDENTIALS" in workflow
    assert "STAGING_CHEMISTRY_SERVICE_TOKEN" in workflow
    assert "build-chemistry-image.sh" in workflow
    assert "deploy-chemistry-cloud-run.sh" in workflow
    assert "verify-chemistry-release.sh" in workflow
    assert workflow.count("STAGING_ENGINE_CANDIDATE: '1'") >= 2
    assert workflow.count("STAGING_OPENROUTER_MODEL: qwen/qwen3.8-27b") >= 2
    assert "staging-release-evidence" in workflow
    assert "image_digest=" in workflow
    assert "secrets." not in workflow[workflow.index("Record sanitized staging release evidence"):]
    assert workflow.index("Require successful CI push run") < workflow.index("google-github-actions/auth")
    assert workflow.index("google-github-actions/auth") < workflow.index("build-chemistry-image.sh")
    assert workflow.index("build-chemistry-image.sh") < workflow.index("deploy-chemistry-cloud-run.sh")
