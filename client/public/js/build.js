/**
 * Which build of the client this is. The Dockerfile overwrites this file with
 * the git commit and date (OPENRADLR_BUILD_SHA / OPENRADLR_BUILD_DATE);
 * `dev` is what you get when running from a checkout.
 */
export const BUILD = { sha: "dev", date: "" };
