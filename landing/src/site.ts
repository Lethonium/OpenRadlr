// Links and names used across the landing page. Build-time environment
// variables override them (see landing/README.md), so a self-hoster can build
// the page for their own domains.

const env = import.meta.env;

export const site = {
  name: "OpenRadlr",
  url: env.PUBLIC_SITE_URL || "https://openradlr.com",
  appUrl: env.PUBLIC_APP_URL || "https://app.openradlr.com",
  githubUrl: "https://github.com/Lethonium/OpenRadlr",
  // Empty until the community server exists (#44); the page then links GitHub only.
  discordUrl: env.PUBLIC_DISCORD_URL || "",
  // The operator's privacy policy and imprint (legal notice), linked in the
  // footer. E.g. a page generated with online-impressum.de; empty = no link,
  // so every self-hoster provides their own.
  privacyUrl: env.PUBLIC_PRIVACY_URL || "",
  imprintUrl: env.PUBLIC_IMPRINT_URL || "",
  // Cookie-free Plausible, as in the app. Unset = no analytics script at all.
  plausibleDomain: env.PUBLIC_PLAUSIBLE_DOMAIN || "",
  plausibleScript: env.PUBLIC_PLAUSIBLE_SCRIPT || "https://plausible.io/js/script.js",
  description:
    "Free, open-source indoor cycling in the browser. Connect your smart trainer and ride an island world together with friends and bots.",
};

/** The app's address without the scheme, for button captions. */
export const appHost = site.appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
