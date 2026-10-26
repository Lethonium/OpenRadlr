/**
 * The beep and buzz in the last seconds of a block. Both outputs are injected
 * (an AudioContext and navigator.vibrate); a missing one is skipped.
 */

const BEEP_HZ = 880;
const BEEP_S = 0.06;
const BEEP_GAIN = 0.2;
const BUZZ_MS = 30;

/** @returns {() => void} plays one cue */
export function createCue({ audioContext = null, vibrate = null } = {}) {
  return () => {
    if (audioContext) {
      // A context made before the first tap starts suspended.
      if (audioContext.state === "suspended") audioContext.resume?.();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = BEEP_HZ;
      gain.gain.value = BEEP_GAIN;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const start = audioContext.currentTime;
      oscillator.start(start);
      oscillator.stop(start + BEEP_S);
    }
    vibrate?.(BUZZ_MS);
  };
}
