import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// The changelog page renders the repository's CHANGELOG.md, so there is one
// changelog to maintain.
const changelog = defineCollection({
  loader: glob({ base: "..", pattern: "CHANGELOG.md" }),
});

export const collections = { changelog };
