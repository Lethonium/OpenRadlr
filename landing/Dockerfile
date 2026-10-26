# OpenRadlr landing page: Astro builds static files, Caddy serves them.
# Build from the repository root (the page reads ../routes and ../CHANGELOG.md):
#
#   docker build -f landing/Dockerfile .

FROM node:24-alpine AS build
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

FROM caddy:2-alpine
COPY landing/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/landing/dist /srv
