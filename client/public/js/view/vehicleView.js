/**
 * Shared vehicles (#55): the create form, the board-with-code form and the
 * seats of the vehicle I'm on. Text goes in with textContent only, because
 * rider names come from the server.
 */
import { isPaddler } from "./panels.js";
import { VEHICLE_KINDS, kindName, normaliseCode, vehicleLabel } from "../ride/vehicle.js";

export class VehicleView {
  #doc;
  #handlers;
  #compact;
  #code = null;
  #nodes = {};

  /**
   * @param {HTMLElement} root
   * @param {{ onCreate?: (v: {kind: string, seats: number, bots: boolean}) => void, onBoard?: (code: string) => void, onLeave?: () => void }} handlers
   * @param {{ compact?: boolean }} options compact: seats only (broadcast panel), no forms, code or Leave
   */
  constructor(root, handlers = {}, { compact = false } = {}) {
    this.root = root;
    this.#doc = root.ownerDocument ?? document;
    this.#handlers = handlers;
    this.#compact = compact;
    root.hidden = true;
    if (compact) {
      this.#buildAboard();
      root.append(this.#nodes.aboard);
    } else {
      this.#buildCreate();
      this.#buildBoard();
      this.#buildAboard();
      root.append(this.#nodes.create, this.#nodes.board, this.#nodes.aboard);
    }
    this.#showOnly(null);
  }

  showCreate() {
    this.#showOnly("create");
  }

  showBoard() {
    this.#showOnly("board");
    this.#nodes.input?.focus?.();
  }

  /** Renders the vehicle I'm on, or hides the panel for `null`. */
  update(vehicleState, myId, riders = []) {
    if (!vehicleState) {
      this.#code = null;
      this.#nodes.aboard.hidden = true;
      this.root.hidden = this.#compact || (this.#nodes.create.hidden && this.#nodes.board.hidden);
      return;
    }
    this.#code = vehicleState.code;
    const seats = vehicleState.seats ?? [];
    const captain = seats.find((s) => s?.rider_id === vehicleState.captain);
    const n = this.#nodes;
    n.title.textContent = captain ? vehicleLabel(vehicleState.kind, captain.name) : kindName(vehicleState.kind);
    if (n.code) n.code.textContent = vehicleState.code;
    n.captain.textContent = captain ? `Captain: ${captain.name} steers` : "";
    n.seats.replaceChildren(...seats.map((seat, i) => this.#seatRow(seat, i, myId, riders)));
    this.#showOnly("aboard");
  }

  #seatRow(seat, index, myId, riders) {
    const li = this.#el("li", "vehicle-seat");
    if (!seat) {
      li.classList.add("free");
      li.append(this.#el("span", "vehicle-seat-no", String(index + 1)), this.#el("span", "vehicle-seat-name", "Free seat"));
      return li;
    }
    const me = seat.rider_id === myId;
    if (me) li.classList.add("me");
    const marks = [me ? "you" : null, seat.is_bot ? "bot" : null, isPaddler(riders.find((r) => r.id === seat.rider_id)) ? "paddle" : null].filter(Boolean).join(" · ");
    const bar = this.#el("span", "vehicle-share-bar");
    const fill = this.#el("span", "vehicle-share-fill");
    const percent = Math.round(Math.min(1, Math.max(0, seat.share ?? 0)) * 100);
    fill.style.width = `${percent}%`;
    bar.append(fill);
    li.append(
      this.#el("span", "vehicle-seat-no", String(index + 1)),
      this.#el("span", "vehicle-seat-name", seat.name),
      this.#el("small", "vehicle-seat-marks", marks),
      this.#el("span", "vehicle-seat-power", `${Math.round(seat.power ?? 0)} W`),
      bar,
      this.#el("span", "vehicle-seat-share", `${percent} %`),
    );
    return li;
  }

  #showOnly(name) {
    for (const key of ["create", "board", "aboard"]) {
      if (this.#nodes[key]) this.#nodes[key].hidden = key !== name;
    }
    this.root.hidden = name === null;
  }

  #buildCreate() {
    const form = this.#el("form", "vehicle-form");
    const kind = this.#el("select");
    kind.setAttribute("aria-label", "Vehicle");
    for (const k of VEHICLE_KINDS) kind.append(this.#option(k.kind, kindName(k.kind)));
    const seats = this.#el("select");
    seats.setAttribute("aria-label", "Seats");
    const fillSeats = () => {
      const options = VEHICLE_KINDS.find((k) => k.kind === kind.value)?.seats ?? [];
      seats.replaceChildren(...options.map((count) => this.#option(String(count), `${count} seats`)));
      seats.value = String(options[0]);
    };
    kind.value = VEHICLE_KINDS[0].kind;
    kind.addEventListener("change", fillSeats);
    fillSeats();
    const bots = this.#el("input");
    bots.type = "checkbox";
    bots.checked = true;
    const botsLabel = this.#el("label", "check");
    botsLabel.append(bots, " Bots fill free seats");
    const submit = this.#el("button", "primary", "Create");
    submit.type = "submit";
    form.append(kind, seats, botsLabel, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault?.();
      this.#handlers.onCreate?.({ kind: kind.value, seats: Number(seats.value), bots: bots.checked });
    });
    this.#nodes.create = form;
    this.#nodes.kind = kind;
    this.#nodes.seatCount = seats;
  }

  #buildBoard() {
    const form = this.#el("form", "vehicle-form");
    const input = this.#el("input");
    input.type = "text";
    input.maxLength = 12;
    input.autocomplete = "off";
    input.placeholder = "Vehicle code";
    input.setAttribute("aria-label", "Vehicle code");
    const error = this.#el("p", "error");
    error.setAttribute("role", "alert");
    const submit = this.#el("button", "primary", "Board with code");
    submit.type = "submit";
    form.append(input, submit, error);
    form.addEventListener("submit", (event) => {
      event.preventDefault?.();
      const { code, error: problem } = normaliseCode(input.value);
      error.textContent = problem ?? "";
      if (code) this.#handlers.onBoard?.(code);
    });
    this.#nodes.board = form;
    this.#nodes.input = input;
    this.#nodes.boardError = error;
  }

  #buildAboard() {
    const box = this.#el("div", "vehicle-aboard");
    const title = this.#el("strong", "vehicle-title");
    const captain = this.#el("p", "vehicle-captain");
    const seats = this.#el("ol", "vehicle-seats");
    box.append(title);
    if (!this.#compact) {
      const code = this.#el("strong", "vehicle-code");
      const copy = this.#el("button", "secondary", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => this.#copy());
      const row = this.#el("p", "vehicle-code-row");
      row.append("Code ", code, " ", copy);
      box.append(row);
      this.#nodes.code = code;
    }
    box.append(captain, seats);
    if (!this.#compact) {
      const leave = this.#el("button", "secondary", "Leave");
      leave.type = "button";
      leave.addEventListener("click", () => this.#handlers.onLeave?.());
      box.append(leave);
    }
    this.#nodes.aboard = box;
    this.#nodes.title = title;
    this.#nodes.captain = captain;
    this.#nodes.seats = seats;
  }

  #copy() {
    if (!this.#code) return;
    Promise.resolve(globalThis.navigator?.clipboard?.writeText(this.#code)).catch(() => {});
  }

  #option(value, text) {
    const option = this.#el("option", "", text);
    option.value = value;
    return option;
  }

  #el(tag, className, text) {
    const node = this.#doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
}
