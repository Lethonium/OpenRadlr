/**
 * Talks to the server's Strava routes (the server holds the tokens; the
 * browser only has an HttpOnly session cookie). `fetch` is injected for tests.
 */

export const activityUrl = (id) => `https://www.strava.com/activities/${id}`;

/** Text for `?strava=…` after coming back from Strava, or null. */
export function stravaMessage(param) {
  switch (param) {
    case "denied":
      return "Strava wasn't connected (you cancelled on Strava).";
    case "expired":
      return "The Strava login took too long or came from another tab. Please try again.";
    case "failed":
      return "Strava didn't answer as expected. Please try again in a moment.";
    default:
      return null;
  }
}

/**
 * The `openradlr://strava?result=…&ticket=…` URL an app login ends on (see
 * the server's AppLogins): what happened, and the ticket to claim the session.
 */
export function appLoginResult(url) {
  try {
    const params = new URL(url).searchParams;
    return { result: params.get("result") ?? "failed", ticket: params.get("ticket") };
  } catch {
    return { result: "failed", ticket: null };
  }
}

export class StravaClient {
  /** @param {{fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>}} [deps] */
  constructor({ fetch: fetchFn = (...args) => globalThis.fetch(...args), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.fetch = fetchFn;
    this.sleep = sleep;
  }

  /** The connected account, or null. */
  async me() {
    const response = await this.fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    return response.json();
  }

  /**
   * The app starts a login for the system sign-in sheet (docs/app.md): the
   * server keeps its secret in this web view's cookies and answers the URL
   * the sheet opens.
   */
  async startAppLogin() {
    const { url } = await this.#json(await this.fetch("/auth/strava/app", { method: "POST", credentials: "same-origin" }));
    return url;
  }

  /** Back from the sheet: trades the ticket for this web view's session cookie. */
  async claimAppLogin(ticket) {
    const response = await this.fetch("/auth/strava/app/claim", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    if (!response.ok) await this.#json(response);
  }

  async logout() {
    await this.fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  }

  async #json(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
    return body;
  }

  /**
   * Uploads a ride: a FIT file (bytes), or TCX (text); resolves with
   * Strava's upload status ({id, status, error, activity_id}).
   */
  async upload(file, name) {
    const fit = typeof file !== "string";
    const response = await this.fetch(`/api/strava/upload?name=${encodeURIComponent(name)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": fit ? "application/vnd.ant.fit" : "application/vnd.garmin.tcx+xml" },
      body: file,
    });
    return this.#json(response);
  }

  /**
   * Polls until Strava turned the upload into an activity, reported an
   * error, or `tries` ran out; resolves with the last status.
   */
  async waitForActivity(upload, { tries = 15, delayMs = 2000 } = {}) {
    let status = upload;
    for (let i = 0; i < tries && !status.activity_id && !status.error; i += 1) {
      await this.sleep(delayMs);
      status = await this.#json(await this.fetch(`/api/strava/upload/${upload.id}`, { credentials: "same-origin" }));
    }
    return status;
  }
}
