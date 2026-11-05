# OpenRadlr landing page: Astro builds static files, Caddy serves them.
# Build from the repository root (the page reads ../routes and ../CHANGELOG.md):
#
#   docker build -f landing/Dockerfile .

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /src/landing
COPY landing/package.json landing/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY routes /src/routes
COPY CHANGELOG.md /src/CHANGELOG.md
COPY landing/ ./

# Addresses baked into the page (see landing/README.md).
ARG PUBLIC_SITE_URL=https://openradlr.com
ARG PUBLIC_APP_URL=https://app.openradlr.com
ARG PUBLIC_DISCORD_URL=
ARG PUBLIC_PRIVACY_URL=
ARG PUBLIC_IMPRINT_URL=
ARG PUBLIC_PLAUSIBLE_DOMAIN=
ARG PUBLIC_PLAUSIBLE_SCRIPT=
ENV ASTRO_TELEMETRY_DISABLED=1
RUN npm run build

FROM caddy:2-alpine@sha256:70b3180738b46cd88e49b300d790ae448a0aca3f58edef0f000bb57d619a9ab3
COPY landing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/landing/dist /srv
