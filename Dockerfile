# On-Demand NaaS UI: one static Cloud Run service, `naas-ui`, serving
# https://aihub.<domain>/naas/* behind the AI Hub load balancer.
#
# Stage 1 installs dependencies (including @aicoe/aihub-platform from the
# aihub-npm Artifact Registry), builds the SPA and renders the nginx config.
# Stage 2 is nginx, unprivileged, holding only those two outputs.
#
# Requires BuildKit (the default builder since Docker 23) for the secret mount:
#
#   docker build --secret id=npmrc,src=<path to an .npmrc with the registry token> .
#
# The token file is mounted for the one RUN that installs, and never written to
# a layer, an ARG, an ENV or the build cache. See README.md, "Building the image".

# ── Stage 1: build the SPA ───────────────────────────────────────────────────
FROM node:24.20.0-alpine3.24 AS build

# The URL path segment this app owns. Must match `slug` in src/app/config.ts and the
# load balancer's path rule.
ARG SLUG=naas
# Extra CSP origins, exactly as aihub-bff's CSP_CONNECT_SRC_EXTRA /
# object_store_origin. Part of the image, not the environment: they are a
# property of the code (e.g. NaaS's map tiles), the same in every environment.
ARG CSP_CONNECT_SRC_EXTRA="https://tiles.openfreemap.org"
ARG CSP_OBJECT_STORE_ORIGIN=""

WORKDIR /build

# .npmrc carries only the @aicoe scope -> registry mapping, never a token. The
# lockfile is globbed so a not-yet-bootstrapped repo still builds locally;
# package.json always matches, so the COPY never has zero sources.
COPY package.json package-lock.json* .npmrc ./

# The token arrives as /run/secrets/npmrc for this RUN only. npm reads it as the
# user config; the project .npmrc above still supplies the scope mapping.
RUN --mount=type=secret,id=npmrc,required=true \
    if [ -f package-lock.json ]; then \
      NPM_CONFIG_USERCONFIG=/run/secrets/npmrc npm ci --no-audit --no-fund; \
    else \
      echo "WARNING - no package-lock.json: resolving with npm install. CI refuses this; see README.md, 'Lockfile bootstrap'." >&2; \
      NPM_CONFIG_USERCONFIG=/run/secrets/npmrc npm install --no-audit --no-fund; \
    fi

COPY . .
RUN npm run build

RUN sh nginx/render-conf.sh nginx/default.conf.template /build/default.conf \
      "$SLUG" "$CSP_CONNECT_SRC_EXTRA" "$CSP_OBJECT_STORE_ORIGIN"


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
# Pinned: nginx stable 1.30.6 on Alpine 3.24. Runs as uid 101 and listens on
# 8080, so no root and no privileged port.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24 AS runtime

ARG SLUG=naas

# The stock default.conf is replaced, not edited; nothing goes under
# /etc/nginx/templates/, so the entrypoint's envsubst step has nothing to do.
COPY --from=build --chown=root:root /build/default.conf /etc/nginx/conf.d/default.conf
# Served at /<slug>/... because the load balancer does not strip the prefix;
# Vite's `base` puts the same prefix on every URL inside the bundle.
COPY --from=build --chown=root:root /build/dist /usr/share/nginx/html/${SLUG}

ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

USER 101

EXPOSE 8080

# No HEALTHCHECK: Cloud Run probes the port itself, and /healthz is there for an
# HTTP probe. The base image's CMD (nginx -g 'daemon off;') is kept.
