# On-Demand NaaS UI (`naas-ui`)

The front end of the On-Demand NaaS use case on the Colt AI Hub: a React SPA served
as static files by nginx from its own Cloud Run service, `naas-ui`, in
`gclt-aicoe-dev-st` (`europe-west3`).

It was split out of `code-scanning-toolset/shared-aihub-ui`,
where the same pages ran inside the hub. The use-case code under
`src/usecases/naas/` and `src/usecases/base.ts` is copied unchanged from the
hub's `frontend/src/usecases/`; the shell, sign-in, API client, job tracker and
UI primitives come from the shared package `@aicoe/aihub-platform`.

GitLab: `code-scanning-toolset/shared-naas-ui`. Branches `sandbox` → `dev` → `prod`.

## How requests reach this app

```
browser ──► https://aihub.aicoedev-int.colt.net/...
              │  internal load balancer (one host for the hub and every use case)
              │
              ├── /naas, /naas/*         ──► naas-ui   (this repo: nginx, static files)
              ├── /auth/*, /api/*, /platform/*    ──► aihub-bff     (session, CSRF, Apigee proxy)
              └── everything else (/, /support, …) ──► aihub-bff     (the hub SPA)
```

- **Same host, path-routed.** The load balancer does **not** rewrite the path, so
  this container receives `/naas`, `/naas/`, `/naas/assets/…` and
  deep links such as `/naas/some/page`. The bundle is built for that prefix
  (`base: '/naas/'` in `vite.config.ts`) and nginx serves it from
  `/usr/share/nginx/html/naas/`.
- **Same origin for the API.** The app calls `/auth/*`, `/api/naas/v1/*` and
  `/platform/*` with relative paths. Those are served by `aihub-bff`, never by
  this container: nginx proxies nothing. Sign-in is the hub's
  `__Host-AISESSION` cookie, which the browser sends because the host is the same.
- **Leaving the app is a page load.** The sidebar's "AI Hub" link, the
  breadcrumb root and "Feedback & support" are full-page links: the hub is a
  different service behind the same load balancer. A client-side navigation to
  a path outside `/naas` (e.g. a "back" button calling `navigate('/')`) is
  turned into a full-page load too (`src/AppRoutes.tsx`).

### No router basename

`src/AppRoutes.tsx` mounts the manifest exactly as the hub's `router.tsx` does,
with **no** `basename`. The manifest's routes (`naas/...`), its sidebar
entries and the vertical's own links are written as paths on the shared host,
because that is what they are in the hub; a basename of `/naas` would prefix
each of them a second time. Since only `/naas/*` ever reaches this app, host
paths and router paths are the same thing.

The one platform path outside the app is `/denied`: `RequireRole` redirects a
user without the role there. This app forwards it to `/naas/denied`, so the
access-denied page renders here, with this app's chrome, and survives a reload.

### What nginx does

`nginx/default.conf.template`, rendered at image build time (never at container
start) by `nginx/render-conf.sh`:

| Request | Response |
|---|---|
| `/naas` | `301`, `Location: /naas/` (relative: `absolute_redirect off`), query string kept |
| `/naas/`, `/naas/any/deep/link` | `200` `index.html`, `Cache-Control: no-store` |
| `/naas/assets/<hashed file>` | `200`, `Cache-Control: public, max-age=31536000, immutable` |
| `/naas/assets/<missing file>` | `404` — never `index.html`, so a stale chunk after a deploy fails loudly |
| `/naas/favicon.svg` (other real files) | `200`, `Cache-Control: no-cache` |
| anything outside `/naas` | `404` (the load balancer never sends it; fail closed) |
| `/healthz` | `200 ok` for probes (not routed by the load balancer) |

Every response carries the same security headers `aihub-bff` sends with the
hub SPA (`bff/app/kernel/observability/security_headers.py`):
`Content-Security-Policy` (its `build_csp()`, non-dev form, directive for
directive), `Strict-Transport-Security`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` and
`Cross-Origin-Opener-Policy`. `server_tokens off` (`Server: nginx`, no version);
gzip for JS, CSS, SVG and JSON; the process runs as uid 101
(`nginxinc/nginx-unprivileged`, pinned) on port 8080.

The CSP's two per-app inputs are Dockerfile `ARG`s, because they are a property
of the code rather than of an environment:

| ARG | This repo | Meaning (BFF equivalent) |
|---|---|---|
| `CSP_CONNECT_SRC_EXTRA` | https://tiles.openfreemap.org | Extra `connect-src` origins, e.g. NaaS's map tiles (`CSP_CONNECT_SRC_EXTRA`) |
| `CSP_OBJECT_STORE_ORIGIN` | (empty) | Added to `connect-src`, `img-src`, `media-src` when the browser PUTs to signed GCS URLs (`object_store_origin`) |

An empty value adds nothing.

## Local development

You need Node `>= 22.22.2` (CI and the image use 24.20.0), and the hub's BFF
running locally on `:8080` — the same one the hub uses. It mints a dev session
and serves mock upstreams, so no GCP credentials or VPN are needed for it.

```bash
# terminal 1 — BFF on :8080, from a shared-aihub-ui checkout
cd shared-aihub-ui/bff && . .venv/bin/activate
AUTH_MODE=dev UPSTREAM_MODE=mock IAP_ENABLED=false SERVE_SPA=false \
TRANSLATION_UPLOAD_MODE=multipart \
  uvicorn app.main:app --reload --port 8080

# terminal 2 — this app on :5173
npm ci            # registry auth needed, see below
npm run dev
```

Open <http://localhost:5173/naas/>. Vite forwards `/auth`, `/api` and
`/platform` to the BFF (`BFF_ORIGIN` overrides `http://localhost:8080`). The
first request is `GET /auth/session`; it 401s, the app redirects to
`/auth/login`, and in dev mode the BFF mints a session and redirects back. Set
`DEV_SESSION_ROLES` on the BFF (comma-separated) to change entitlements, e.g.
without this app's role to see `/naas/denied`.

Links back to the hub (`/`, `/support`) leave the Vite server, which serves only
`/naas/`; run the hub's own `npm run dev` if you need both.

```bash
npm run lint
npm run typecheck
npm run test          # vitest, jsdom
npm run build         # tsc -b && vite build -> dist/
```

### Registry access for `@aicoe/aihub-platform`

The package is published by `shared-aihub-ui`'s manual `publish-platform-package`
job, run from a pipeline on its protected `dev` branch (no tags are involved),
to the `aihub-npm` Artifact Registry repository in `gclt-aicoe-dev-aihub-ui`. The
committed `.npmrc` maps the `@aicoe` scope to it and holds **no token**. Put a
short-lived token in your **user-level** `~/.npmrc`, never in the repo:

```bash
gcloud auth login   # an identity with artifactregistry.reader on aihub-npm
npm config set --location=user \
  "//europe-west3-npm.pkg.dev/gclt-aicoe-dev-aihub-ui/aihub-npm/:_authToken" \
  "$(gcloud auth print-access-token)"
```

The token lasts an hour; rerun the second command when `npm` starts returning 401/403.

### Lockfile bootstrap

`package.json` pins `"@aicoe/aihub-platform": "0.1.0"`. Until version `0.1.0`
is published there is nothing to resolve it against, so this repo starts
**without** `package-lock.json`, and CI refuses to run until it has one: every
CI install is `npm ci`, and the `.require_lockfile` guard fails the job with a
pointer back here.

Once the package is published, do this **once**:

```bash
# with registry auth in ~/.npmrc (above)
rm -rf node_modules
npm install
# each must print nothing:
grep -E '"resolved": *"' package-lock.json | grep -Ev '"resolved": *"https://'   # every "resolved" is https://
grep -E '"link": *true' package-lock.json                                       # no linked local checkout
grep -E '"(file|link):' package.json                                            # no local spec in package.json
# must print the aihub-npm registry URL from .npmrc:
grep -A3 '"node_modules/@aicoe/aihub-platform"' package-lock.json | grep '"resolved"'
git add package-lock.json && git commit -m "Add package-lock.json"
```

Never commit a lockfile produced while testing against a local tarball or a
local checkout of the package. Test with `npm install --no-save <path>.tgz`,
which writes neither `package.json` nor a lockfile; without `--no-save` it
records a `file:` path that exists only on your machine, and
`npm install <path to a checkout>` records a `"link": true` entry. CI's
`.require_lockfile` guard rejects either, a `file:`/`link:` spec in
`package.json`, any non-`https://` `"resolved"`, and a lockfile in which
`@aicoe/aihub-platform` resolves from anywhere but the registry in `.npmrc`.

To take a newer platform release later: bump the version in `package.json`, run
`npm install` with registry auth, and commit both files.

## Building the image

The Dockerfile installs inside the build stage, so it needs the registry token
too. It takes it as a **BuildKit secret**, mounted for the one `RUN` that
installs; it never lands in a layer, an `ARG`, an `ENV` or the build cache.

```bash
umask 077
printf '%s\n' \
  "@aicoe:registry=https://europe-west3-npm.pkg.dev/gclt-aicoe-dev-aihub-ui/aihub-npm/" \
  "//europe-west3-npm.pkg.dev/gclt-aicoe-dev-aihub-ui/aihub-npm/:_authToken=$(gcloud auth print-access-token)" \
  > /tmp/aihub-npm.npmrc

docker build --secret id=npmrc,src=/tmp/aihub-npm.npmrc -t naas-ui:local .
rm -f /tmp/aihub-npm.npmrc

docker run --rm -p 8080:8080 naas-ui:local
curl -sI http://localhost:8080/naas        # 301, Location: /naas/
curl -sI http://localhost:8080/naas/       # 200, no-store, CSP
```

The container alone has no BFF behind it, so the app will show "Signing you in…"
and then fail its session probe; that is expected. Use the Vite setup above to
work on the app itself.

The image has no runtime configuration and no environment variables, so the
same image is promoted unchanged from `sandbox` to `dev` to `prod`.

## CI/CD and deployment

`.gitlab-ci.yml` mirrors the st backends (`shared-translation`,
`shared-salesagent`) and `shared-aihub-ui`'s front-end job; variables are listed
in [`GITLAB_CI_VARIABLES.md`](GITLAB_CI_VARIABLES.md).

| Stage | Job | Notes |
|---|---|---|
| lint | `sast`, `secret_detection`, `frontend-checks`, `env-scope-check` (manual) | `frontend-checks` = `npm ci`, lint, typecheck, test |
| test | `dependency_scanning` | Reads `package-lock.json` |
| build | `build-and-push` (manual) | `docker build` with the npmrc secret, push to `europe-west3-docker.pkg.dev/gclt-aicoe-dev-st/containers/naas-ui:<pipeline iid>` |
| deploy | `deploy-cloud-run` (manual) | `naas-ui`, runtime SA `naas-ui-sa`, `--ingress=internal-and-cloud-load-balancing`, `--no-allow-unauthenticated`, `--min-instances=0`, port 8080, Direct VPC egress `private-ranges-only` |
| promote | `promote-sandbox-to-dev`, `promote-dev-to-prod` (manual) | Fast-forward pushes, as in the backends |

Authentication is Workload Identity Federation as `tf-deployer@gclt-aicoe-dev-st`
for everything: reading the npm package (it holds `artifactregistry.reader` on
`aihub-npm`), pushing the image and deploying. The npm token is written to a
job-local file outside the repository and deleted in `after_script`.

There is no DAST job, unlike the backends: the service accepts traffic only
from the internal load balancer, so its `run.app` URL is unreachable from a
runner and a scan would test nothing.

**Binary Authorization.** `gclt-aicoe-dev-st` has a `REQUIRE_ATTESTATION`
policy, but Cloud Run consults it only for services deployed with
`--binary-authorization=default`. No pipeline on the platform attests or passes
that flag today (AICOE-Terraform `docs/24` §2.4a), and this one deploys the same
way. Enabling it is a platform-wide change: attestation in every pipeline first,
then the flag.

### Platform prerequisites (AICOE-Terraform)

Defined in AICOE-Terraform for `sales`, `translation` and `naas`; listed so a
failure points at the right owner.

- `code-scanning-toolset/shared-naas-ui` in `allowed_repositories`
  (`0-bootstrap`). Asserted, not yet observed: if the first job fails with
  "rejected by the attribute condition", compare the real project path against
  the `principalSubject` in the `aicoe-sharedwif` data-access audit log.
- `naas-ui-sa` and `tf-deployer`'s `iam.serviceAccountUser` on it, plus
  `artifactregistry.reader` on `aihub-npm` (`2-foundations`).
- **After the first deploy:** add `naas = "naas-ui"` to `ui_frontends`
  and apply `6b` (serverless NEG, IAP-enabled backend service, Cloud Armor, the
  IAP agent's `run.invoker`), then the manual IAP workforce settings step from
  `docs/16`, then `6c` for the `/naas` path rules. Until then the service
  exists but nothing routes to it.
