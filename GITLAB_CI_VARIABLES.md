# GitLab CI/CD Variables & Deployment Configuration Guide

The GitLab CI/CD variables `.gitlab-ci.yml` needs to build `naas-ui` and deploy it into
**`gclt-aicoe-dev-st`** (`europe-west3`). Modelled on `shared-translation`'s and
`shared-aihub-ui`'s `GITLAB_CI_VARIABLES.md`.

This service has **no runtime configuration**: no `--set-env-vars`, no `/secrets/.env`
payload, no Secret Manager secret. Everything below is read by the pipeline script only.
There are also no `VITE_*` build-time variables: the app calls only relative, same-origin
paths, so one image is promoted unchanged across `sandbox` → `dev` → `prod`.

---

## 1. Summary

| Category | Mechanism | Notes |
|---|---|---|
| WIF & CI runner identity | GitLab CI/CD variable | Same values as every st repo |
| GCP project / region / registry | GitLab CI/CD variable | `gclt-aicoe-dev-st`, `europe-west3`, `containers` |
| Cloud Run service / network / runtime SA | GitLab CI/CD variable, with slug defaults in `.gitlab-ci.yml` | `naas-ui`, `naas-ui-sa` |
| npm registry for `@aicoe/aihub-platform` | Committed `.npmrc` (no token) | Token minted per job from the WIF identity |
| Pipeline access tokens | GitLab CI/CD variable (masked, protected) | `GITLAB_PUSH_TOKEN` |

---

## 2. GitLab CI/CD Variables (scope `dev`)

### A. Workload Identity Federation & Authentication

| Variable | Value | Source |
|---|---|---|
| `WORKLOAD_IDENTITY_PROJECT_NUMBER` | `538669417284` | `aicoe-sharedwif` project number |
| `WORKLOAD_IDENTITY_POOL` | `gitlab-pool` | Stage 0 |
| `WORKLOAD_IDENTITY_PROVIDER` | `gitlab-provider` | Stage 0 |
| `SERVICE_ACCOUNT` | `tf-deployer@gclt-aicoe-dev-st.iam.gserviceaccount.com` | Stage 0; `code-scanning-toolset/shared-naas-ui` must be in `allowed_repositories` |

The same identity reads the npm package: it holds `roles/artifactregistry.reader` on
`aihub-npm` in `gclt-aicoe-dev-aihub-ui` (AICOE-Terraform `2-foundations`,
`gclt_aicoe_dev_aihub_ui_npm_st_ci_reader`). No separate npm credential exists.

### B. GCP Infrastructure

| Variable | Value | Source |
|---|---|---|
| `GCP_PROJECT_ID` | `gclt-aicoe-dev-st` | `terraform/2-foundations/gclt-aicoe-dev-st.tf` |
| `GCP_REGION` | `europe-west3` | Platform-wide convention |
| `ARTIFACT_REPO` | `containers` | CMEK Docker repository in `gclt-aicoe-dev-st` |
| `IMAGE_NAME` | `naas-ui` | **Defaulted** in `.gitlab-ci.yml`; set only to override |

Image: `europe-west3-docker.pkg.dev/gclt-aicoe-dev-st/containers/naas-ui:<CI_PIPELINE_IID>`.

### C. Cloud Run Service, Network & Runtime Identity

| Variable | Value | Source |
|---|---|---|
| `CLOUD_RUN_SERVICE` | `naas-ui` | **Defaulted** in `.gitlab-ci.yml`; must match `ui_frontends` in AICOE-Terraform 6b |
| `CLOUD_RUN_SA` | `naas-ui-sa@gclt-aicoe-dev-st.iam.gserviceaccount.com` | Stage 2. **Required, no fallback.** Holds no roles: it exists only to keep the default compute SA out. `tf-deployer` has `iam.serviceAccountUser` on it (`st_ci_run_as`) |
| `CLOUD_RUN_NETWORK` | `projects/gclt-aicoe-dev-network/global/networks/gclt-aicoe-dev-vpc` | Stage 3 |
| `CLOUD_RUN_SUBNET` | `projects/gclt-aicoe-dev-network/regions/europe-west3/subnetworks/gclt-aicoe-dev-cloudrun-ew3` | Stage 3 |
| `CLOUD_RUN_MAX_INSTANCES` | `5` | Optional, defaults to `5` |
| `CLOUD_RUN_MEMORY` | `256Mi` | Optional, defaults to `256Mi` |

Fixed in `.gitlab-ci.yml`, not variables: `--ingress=internal-and-cloud-load-balancing`,
`--no-allow-unauthenticated`, `--min-instances=0`, `--port=8080`,
`--vpc-egress=private-ranges-only` (nginx makes no outbound calls).

### D. Pipeline Access & Runner Environment (masked, protected)

| Variable | Notes |
|---|---|
| `GITLAB_PUSH_TOKEN` | `write_repository`, for the promotion jobs |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Corporate runner egress; passed to `docker build` as build args |

There is no `AZURE_PAT` and no `sync-from-azure` job: this repository lives in GitLab only.

### E. Committed in `.gitlab-ci.yml` (not CI/CD variables)

| Variable | Value | Why it is not a setting |
|---|---|---|
| `SLUG` | `naas` | Baked into the bundle (`vite.config.ts` `base`) and nginx; must match the load balancer's path rule |
| `NODE_VERSION` | `24.20.0` | Same as the Dockerfile's build stage |

---

## 3. Scope `sandbox` and `prod`

Same variable names. `prod` takes the prod project's values (project, network, subnet,
runtime SA, WIF service account) once the prod use-case project exists; nothing in
`.gitlab-ci.yml` names an environment.

---

## 4. Order of Operations

```
[AICOE-Terraform: allowed_repositories, naas-ui-sa + actAs, aihub-npm reader]
              │
              ▼
[shared-aihub-ui: run the manual publish-platform-package job on dev (@aicoe/aihub-platform@0.1.0)]
              │
              ▼
[This repo: commit package-lock.json once (README.md, "Lockfile bootstrap")]
              │
              ▼
[GitLab CI: frontend-checks → build-and-push → deploy-cloud-run]
              │
              ▼
[AICOE-Terraform 6b: ui_frontends += { naas = "naas-ui" }, apply]
              │
              ▼
[Manual: IAP workforce settings on bs-naas-ui (docs/16)]
              │
              ▼
[AICOE-Terraform 6c: /naas path rules on the AI Hub host]
```

6b binds `run.invoker` to the service **by name**, so it fails until the first deploy has
created `naas-ui`.
