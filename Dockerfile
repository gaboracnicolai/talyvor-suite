# The suite in one image: the BFF binary serving the built web app (B28.211).
#
#   docker build --build-arg SUITE_COMMIT=$(git rev-parse --short HEAD) \
#     --build-arg VITE_CONTACT_EMAIL=hello@talyvor.com -t talyvor-suite .
#
# Both halves are built by scripts/build-release.sh, the same script CI and the deploy runbook
# run, so the image carries the same stamp checks. SUITE_COMMIT is required: the build context
# has no .git, and the script refuses to guess.

FROM node:22-alpine AS web
RUN apk add --no-cache bash && npm install -g pnpm@11.1.1
WORKDIR /src
COPY . .
ARG SUITE_COMMIT
# Optional and build-time only: Vite inlines it, and unset the contact CTA does not render
# (deploy/README.md §2).
ARG VITE_CONTACT_EMAIL
RUN pnpm install --frozen-lockfile && SUITE_COMMIT="${SUITE_COMMIT}" scripts/build-release.sh web

FROM golang:1.26.9-alpine AS bff
RUN apk add --no-cache bash
WORKDIR /src
COPY apps/bff/go.mod apps/bff/go.sum apps/bff/
RUN cd apps/bff && go mod download
COPY scripts/build-release.sh scripts/
COPY apps/bff apps/bff
ARG SUITE_COMMIT
RUN SUITE_COMMIT="${SUITE_COMMIT}" GOARCH="$(go env GOARCH)" scripts/build-release.sh bff && mv bff-linux-* /out-bff

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -S -H bff
COPY --from=bff /out-bff /usr/local/bin/bff
COPY --from=web /src/apps/web/dist /app/web
USER bff
# Binding beyond loopback is allowed only with BFF_AUTH_MODE=oidc and an https
# BFF_PUBLIC_BASE_URL; the BFF refuses to start otherwise (apps/bff/main.go).
ENV BFF_ADDR=0.0.0.0:8787 WEB_DIST=/app/web
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/bff"]
