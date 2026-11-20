# Production release baseline

Captured: 2026-09-04T16:51:43Z
main SHA: 6e90ec991005004ce908b06e7e51e37c8fe0de46
production SHA: 6e90ec991005004ce908b06e7e51e37c8fe0de46

## GitHub production deployment
{"created_at":"2026-09-04T16:32:46Z","environment":"Production","id":6268642292,"ref":"6e90ec991005004ce908b06e7e51e37c8fe0de46","sha":"6e90ec991005004ce908b06e7e51e37c8fe0de46","statuses_url":"https://api.github.com/repos/TheEnigmaticT/greenprotocol/deployments/6268642292/statuses","url":"https://api.github.com/repos/TheEnigmaticT/greenprotocol/deployments/6268642292"}

## Vercel production deployments
Vercel CLI 50.12.3
Fetching deployments in theenigmaticts-projects
> No deployments found.

## GCP account and Cloud Run production service
{
  "core": {
    "account": "tlongino@crowdtamers.com",
    "project": "greenchemistry-ai"
  }
}
{
  "apiVersion": "serving.knative.dev/v1",
  "kind": "Service",
  "metadata": {
    "annotations": {
      "run.googleapis.com/build-enable-automatic-updates": "false",
      "run.googleapis.com/build-id": "09a2fd3a-b0db-4be1-868b-18b8d3c5fdde",
      "run.googleapis.com/build-image-uri": "us-central1-docker.pkg.dev/greenchemistry-ai/cloud-run-source-deploy/greenchemistry-chemistry",
      "run.googleapis.com/build-name": "projects/450503644772/locations/us-central1/builds/09a2fd3a-b0db-4be1-868b-18b8d3c5fdde",
      "run.googleapis.com/build-source-location": "gs://run-sources-greenchemistry-ai-us-central1/services/greenchemistry-chemistry/1788464185.741958-01a54b99c19b4dca9c621993e76723e9.zip#1788464198756618",
      "run.googleapis.com/client-name": "gcloud",
      "run.googleapis.com/client-version": "583.0.0",
      "run.googleapis.com/ingress": "all",
      "run.googleapis.com/ingress-status": "all",
      "run.googleapis.com/maxScale": "20",
      "run.googleapis.com/operation-id": "10370f5d-15a6-4ffb-b419-11a6231bb37a",
      "run.googleapis.com/urls": "[\"https://greenchemistry-chemistry-450503644772.us-central1.run.app\",\"https://greenchemistry-chemistry-4cisnamb5a-uc.a.run.app\"]",
      "serving.knative.dev/creator": "tlongino@crowdtamers.com",
      "serving.knative.dev/lastModifier": "tlongino@crowdtamers.com"
    },
    "creationTimestamp": "2026-09-01T13:08:58.575814Z",
    "generation": 9,
    "labels": {
      "cloud.googleapis.com/location": "us-central1"
    },
    "name": "greenchemistry-chemistry",
    "namespace": "450503644772",
    "resourceVersion": "AAZaqeifO0I",
    "selfLink": "/apis/serving.knative.dev/v1/namespaces/450503644772/services/greenchemistry-chemistry",
    "uid": "6e9b94b1-ac10-4e0e-9316-d9ef87a75235"
  },
  "spec": {
    "template": {
      "metadata": {
        "annotations": {
          "autoscaling.knative.dev/maxScale": "3",
          "autoscaling.knative.dev/minScale": "1",
          "run.googleapis.com/client-name": "gcloud",
          "run.googleapis.com/client-version": "583.0.0",
          "run.googleapis.com/network-interfaces": "[{\"network\":\"hydration-egress\",\"subnetwork\":\"hydration-us-central1\"}]",
          "run.googleapis.com/startup-cpu-boost": "true",
          "run.googleapis.com/vpc-access-egress": "all-traffic"
        },
        "labels": {
          "client.knative.dev/nonce": "ckzmqxrafu",
          "run.googleapis.com/startupProbeType": "Default"
        }
      },
      "spec": {
        "containerConcurrency": 4,
        "containers": [
          {
            "env": [
              {
                "name": "CHEMISTRY_SERVICE_TOKEN",
                "valueFrom": {
                  "secretKeyRef": {
                    "key": "latest",
                    "name": "chemistry-service-token"
                  }
                }
              },
              {
                "name": "SUPABASE_URL",
                "valueFrom": {
                  "secretKeyRef": {
                    "key": "latest",
                    "name": "supabase-url"
                  }
                }
              },
              {
                "name": "SUPABASE_SERVICE_ROLE_KEY",
                "valueFrom": {
                  "secretKeyRef": {
                    "key": "latest",
                    "name": "supabase-service-role-key"
                  }
                }
              },
              {
                "name": "ANTHROPIC_API_KEY",
                "valueFrom": {
                  "secretKeyRef": {
                    "key": "latest",
                    "name": "anthropic-api-key"
                  }
                }
              },
              {
                "name": "OPENROUTER_MODEL",
                "value": "anthropic/claude-sonnet-4.5"
              },
              {
                "name": "OPENROUTER_API_KEY",
                "valueFrom": {
                  "secretKeyRef": {
                    "key": "latest",
                    "name": "greenchemistry-openrouter-api-key"
                  }
                }
              }
            ],
            "image": "us-central1-docker.pkg.dev/greenchemistry-ai/cloud-run-source-deploy/greenchemistry-chemistry:openrouter-cae57ca",
            "ports": [
              {
                "containerPort": 8080,
                "name": "http1"
              }
            ],
            "resources": {
              "limits": {
                "cpu": "1",
                "memory": "2Gi"
              }
            },
            "startupProbe": {
              "failureThreshold": 1,
              "periodSeconds": 240,
              "tcpSocket": {
                "port": 8080
              },
              "timeoutSeconds": 240
            }
          }
        ],
        "serviceAccountName": "greenchemistry-chemservice@greenchemistry-ai.iam.gserviceaccount.com",
        "timeoutSeconds": 300
      }
    },
    "traffic": [
      {
        "latestRevision": true,
        "percent": 100
      }
    ]
  },
  "status": {
    "address": {
      "url": "https://greenchemistry-chemistry-4cisnamb5a-uc.a.run.app"
    },
    "conditions": [
      {
        "lastTransitionTime": "2026-09-04T15:27:38.986306Z",
        "status": "True",
        "type": "Ready"
      },
      {
        "lastTransitionTime": "2026-09-04T15:27:25.984241Z",
        "status": "True",
        "type": "ConfigurationsReady"
      },
      {
        "lastTransitionTime": "2026-09-04T15:27:38.947083Z",
        "status": "True",
        "type": "RoutesReady"
      }
    ],
    "latestCreatedRevisionName": "greenchemistry-chemistry-00009-9ld",
    "latestReadyRevisionName": "greenchemistry-chemistry-00009-9ld",
    "observedGeneration": 9,
    "traffic": [
      {
        "latestRevision": true,
        "percent": 100,
        "revisionName": "greenchemistry-chemistry-00009-9ld"
      }
    ],
    "url": "https://greenchemistry-chemistry-4cisnamb5a-uc.a.run.app"
  }
}
