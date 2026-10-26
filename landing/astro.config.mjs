import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://openradlr.com",
  output: "static",
  trailingSlash: "ignore",
  integrations: [sitemap({ filter: (page) => !page.endsWith("/404/") })],
});
