/**
 * The account card's state (ADR 0032): signed out → code sent → signed in, plus
 * passkeys and saving the active rider. Pure apart from its injected
 * collaborators; the view renders `state` on every `onChange`.
 *
 * Signing in on purpose saves the active rider: the button that leads here says
 * "Save your progress". A rider of this device that another account signed in
 * for is saved only when asked.
 */

const ERRORS = {
  wrong_code: "account.error.wrongCode",
  code_expired: "account.error.codeExpired",
  too_many_requests: "account.error.tooMany",
  mail_failed: "account.error.mail",
  bad_email: "account.error.badEmail",
  offline: "account.error.offline",
  passkey_refused: "account.error.passkeyRefused",
  unsupported: "account.error.passkeyUnsupported",
  passkey_exists: "account.error.passkeyExists",
  no_key: "account.error.noKey",
};

/** The text key for a failure. */
export const errorKey = (error) => ERRORS[error?.code ?? error?.message] ?? "account.error.generic";

/** The user closed the browser's passkey dialog: nothing to report. */
const cancelled = (error) => error?.name === "NotAllowedError" || error?.name === "AbortError";

export class AccountFlow {
  /**
   * @param {{
   *   client: import("../net/account.js").AccountClient,
   *   backup: () => import("./backup.js").Backup,
   *   rider: () => Promise<{name: string, publicKey: string | null}> | {name: string, publicKey: string | null},
   *   passkeys: {available: boolean, create?: Function, get?: Function},
   *   lang: () => string,
   *   onChange?: (state: object) => void,
   * }} deps
   */
  constructor({ client, backup, rider, passkeys, lang, onChange = () => {} }) {
    Object.assign(this, { client, backup, rider, passkeys, lang, onChange });
    this.state = { phase: "loading", email: "", sends: 0, me: null, linked: false, created: false, busy: false, error: null, backup: null };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  /** Runs `act` as the one busy step; a failure becomes the state's error. */
  async #step(act) {
    this.#set({ busy: true, error: null });
    try {
      await act();
      this.#set({ busy: false });
    } catch (error) {
      this.#set({ busy: false, error: cancelled(error) ? null : errorKey(error) });
    }
  }

  #signedIn(me) {
    this.#set({ phase: "signedIn", me, linked: this.backup().linkedTo(me) });
  }

  /**
   * Reads the account; call it on start. Unreachable is not signed out: a signed-in rider
   * stays signed in, and a first read that fails leaves the phase "offline" (nothing offered).
   */
  async refresh() {
    await this.#step(async () => {
      try {
        const me = await this.client.me();
        if (me) this.#signedIn(me);
        else this.#set({ phase: this.state.phase === "codeSent" ? "codeSent" : "signedOut", me: null, linked: false });
      } catch (error) {
        if (this.state.phase === "loading") this.#set({ phase: "offline" });
        throw error;
      }
    });
  }

  /** The active rider changed: is the new one saved in the signed-in account? */
  riderChanged() {
    if (this.state.phase === "signedIn") this.#set({ linked: this.backup().linkedTo(this.state.me), backup: null, error: null });
    else this.#set({ error: null });
  }

  async sendCode(email) {
    const address = String(email ?? "").trim();
    if (!address.includes("@")) {
      this.#set({ error: "account.error.badEmail" });
      return;
    }
    await this.#step(async () => {
      await this.client.startEmail(address, this.lang());
      const sends = address === this.state.email ? this.state.sends + 1 : 1;
      this.#set({ phase: "codeSent", email: address, sends });
    });
  }

  /** Another code to the same address (the first may be lost or expired). */
  async resend() {
    await this.sendCode(this.state.email);
  }

  /** Back from the code to the address. */
  changeEmail() {
    this.#set({ phase: "signedOut", error: null });
  }

  async verify(code) {
    // A code is used up by its first check: a second submit (Enter after the sixth digit) waits for none.
    if (this.state.busy) return;
    await this.#step(async () => {
      const me = await this.client.verifyEmail(this.state.email, String(code ?? "").trim());
      this.#set({ created: Boolean(me?.created) });
      await this.#afterSignIn(me);
    });
  }

  async passkeySignIn() {
    await this.#step(async () => {
      const options = await this.client.passkeyLoginOptions();
      const body = await this.passkeys.get(options);
      const me = await this.client.passkeyLogin(body);
      await this.#afterSignIn(me);
    });
  }

  /**
   * Signed in on purpose: save the active rider, unless it is saved already, here or in
   * another account (moving it would take its backups along: that is only done when asked).
   */
  async #afterSignIn(me) {
    this.#signedIn(me);
    if (!this.state.linked && !this.backup().riderId()) await this.#link();
  }

  async #link() {
    // One rider from start to end, even if the active rider changes meanwhile.
    const backup = this.backup();
    const rider = this.rider();
    await backup.link(await rider);
    const me = await this.client.me();
    this.#signedIn(me);
    await this.#runBackup(backup);
  }

  async #runBackup(backup = this.backup()) {
    this.#set({ backup: { running: true } });
    const result = await backup.run();
    this.#set({ backup: { running: false, ...result } });
  }

  /** Saves the active rider to the signed-in account. */
  async saveRider() {
    await this.#step(() => this.#link());
  }

  /** A backup now (after a ride, on start); silent, and only for a saved rider. */
  async backupNow() {
    if (this.state.phase !== "signedIn" || !this.state.linked) return;
    await this.#runBackup();
  }

  async addPasskey(name) {
    await this.#step(async () => {
      const options = await this.client.passkeyRegisterOptions();
      const body = await this.passkeys.create(options, { name });
      // The notice mail about the new passkey is written in the rider's language.
      this.#signedIn(await this.client.passkeyRegister({ ...body, lang: this.lang() }));
    });
  }

  async removePasskey(id) {
    await this.#step(async () => {
      await this.client.deletePasskey(id);
      this.#signedIn(await this.client.me());
    });
  }

  async signOut() {
    await this.#step(async () => {
      await this.client.logout();
      this.#set({ phase: "signedOut", me: null, linked: false, created: false, backup: null });
    });
  }

  async deleteAccount() {
    await this.#step(async () => {
      await this.client.deleteAccount(this.lang());
      this.backup().forget();
      this.#set({ phase: "signedOut", me: null, linked: false, created: false, backup: null });
    });
  }
}
