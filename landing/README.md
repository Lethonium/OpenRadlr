# OpenRadlr landing page

The public page for openradlr.com: a static [Astro](https://astro.build) site
that explains OpenRadlr and links to the app (app.openradlr.com). It is
separate from `client/`, which stays dependency-free.

- `src/pages/index.astro`: the page itself; the privacy policy and imprint are
  operator-provided links (`PUBLIC_PRIVACY_URL`, `PUBLIC_IMPRINT_URL`).
- `src/pages/changelog.astro` renders the repository's `CHANGELOG.md`.
- The hero's elevation profile is drawn at build time from
  `routes/col-de-la-forge.json`, so it always matches the game.
- Colours and fonts follow the app (`client/public/styles.css`).
- Screenshots in `src/assets/` come from the real game; Astro turns them into
  AVIF/WebP in several sizes.

## Build and run

With Docker only (as on the server), from the repository root:

```bash
COMPOSE_PROFILES=landing docker compose up -d --build landing   # http://localhost:8081
```

With Node 22.12+ installed, in `landing/`:

```bash
npm ci
npm run dev       # http://localhost:4321, reloads on save
npm run build     # static files in dist/
```

## Settings (build time)

| Variable | Default | Used for |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | `https://openradlr.com` | canonical links, sitemap, Open Graph |
| `PUBLIC_APP_URL` | `https://app.openradlr.com` | every *Ride now* button |
| `PUBLIC_DISCORD_URL` | – | Discord link; without it the page points to GitHub issues |
| `PUBLIC_PRIVACY_URL` | – | privacy policy link in the footer (the app's `OPENRADLR_PRIVACY_URL`); without it no link is shown |
| `PUBLIC_IMPRINT_URL` | – | imprint (legal notice) link in the footer, e.g. a page from online-impressum.de; without it no link is shown |
| `PUBLIC_PLAUSIBLE_DOMAIN` | – | cookie-free Plausible analytics; without it no script is loaded |
| `PUBLIC_PLAUSIBLE_SCRIPT` | Plausible Cloud (`https://plausible.io/js/script.js`) | script URL, e.g. your own instance |

Docker Compose fills them from `.env` (`OPENRADLR_LANDING_URL`,
`OPENRADLR_PUBLIC_URL`, `OPENRADLR_DISCORD_URL`, `OPENRADLR_PRIVACY_URL`,
`OPENRADLR_LANDING_IMPRINT_URL`,
`OPENRADLR_LANDING_PLAUSIBLE_DOMAIN`, and `PUBLIC_PLAUSIBLE_SCRIPT` from
`OPENRADLR_ANALYTICS_SCRIPT`, the same script the app uses). Deployment: [docs/deploy.md](../docs/deploy.md#landing-page).
