/**
 * Optional page analytics (Plausible-compatible). The operator enables them with
 * OPENRADLR_ANALYTICS_DOMAIN; the server then lists them in /api/info. Without
 * that, no third-party script is ever loaded.
 */

const loaded = new WeakSet();

/**
 * Adds the analytics script from the server info, once per document.
 * @param {{analytics?: {domain: string, script: string}} | null} info from /api/info
 * @param {Document} document
 * @returns {boolean} whether a script was added
 */
export function loadAnalytics(info, document) {
  const analytics = info?.analytics;
  if (!analytics || loaded.has(document)) return false;
  loaded.add(document);
  const script = document.createElement("script");
  script.defer = true;
  script.dataset.domain = analytics.domain;
  script.src = analytics.script;
  document.head.append(script);
  return true;
}
