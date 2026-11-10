/**
 * Keeps a workout connection open: the server closes a joined connection that
 * sends nothing for 120 s, and a workout sends nothing during pauses, on the
 * summary or in a hidden tab (no animation frames). So the current `workout`
 * message (exercise and side) is repeated on a timer; it is idempotent on the server.
 */
export const KEEPALIVE_MS = 30000;

/**
 * @param {{send: (exercise: ?string, side: ?string) => void, current: () => [?string, ?string], setInterval?: Function, clearInterval?: Function}} options
 * @returns {() => void} stops the keepalive
 */
export function startKeepalive({ send, current, setInterval: set = globalThis.setInterval, clearInterval: clear = globalThis.clearInterval }) {
  const id = set(() => send(...current()), KEEPALIVE_MS);
  return () => clear(id);
}
