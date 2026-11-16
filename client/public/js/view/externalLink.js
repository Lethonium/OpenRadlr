/** Operator-provided external destinations must be absolute web addresses. */
export function webUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim();
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname ? url : null;
  } catch {
    return null;
  }
}

/** Show a configured footer link, clearing stale destinations on refresh. */
export function renderExternalLink(element, value) {
  const url = webUrl(value);
  element.hidden = !url;
  if (url) element.href = url;
  else element.removeAttribute("href");
}
