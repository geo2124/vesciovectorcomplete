/**
 * Sound synthesizer and mobile haptic feedback for turnstile QR check-in
 * Uses the Web Audio API (no external asset dependencies) and navigator.vibrate.
 */

export function playCheckInFeedback(type: "success" | "warning" | "error" = "success") {
  if (typeof window === "undefined") return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioContextClass) {
      const ctx = new AudioContextClass();

      // Ensure audio context is running (can be suspended on mobile until user gesture)
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "success") {
        // High-pitched bright double chirp (turnstile chime)
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1); // A6
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.16);

        // Second harmonic
        setTimeout(() => {
          try {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.type = "sine";
            osc2.frequency.setValueAtTime(1318.5, ctx.currentTime); // E6
            gain2.gain.setValueAtTime(0.2, ctx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
            osc2.start(ctx.currentTime);
            osc2.stop(ctx.currentTime + 0.12);
          } catch {
            // ignore
          }
        }, 80);
      } else if (type === "warning") {
        // Lower two-tone alert
        osc.type = "triangle";
        osc.frequency.setValueAtTime(493.88, ctx.currentTime); // B4
        osc.frequency.setValueAtTime(369.99, ctx.currentTime + 0.12); // F#4
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.28);
      } else {
        // Low error buzz
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      }
    }
  } catch (err) {
    console.debug("Web Audio unavailable:", err);
  }

  // Mobile vibration feedback
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (type === "success") {
        navigator.vibrate([40, 30, 40]);
      } else if (type === "warning") {
        navigator.vibrate([100, 50, 100]);
      } else {
        navigator.vibrate([150, 60, 150]);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Emphatic buzzer audio tone and haptic feedback pattern for blocked check-in (Inactive / Suspended)
 */
export function playBlockedBuzzerFeedback() {
  if (typeof window === "undefined") return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      if (ctx.state === "suspended") ctx.resume();

      // First harsh buzz
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(140, ctx.currentTime);
      gain1.gain.setValueAtTime(0.35, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.22);

      // Second deeper buzzer tone
      setTimeout(() => {
        try {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.type = "sawtooth";
          osc2.frequency.setValueAtTime(110, ctx.currentTime);
          gain2.gain.setValueAtTime(0.4, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
          osc2.start(ctx.currentTime);
          osc2.stop(ctx.currentTime + 0.35);
        } catch {
          // ignore
        }
      }, 160);
    }
  } catch (err) {
    console.debug("Web Audio error buzzer unavailable:", err);
  }

  // Intense haptic pattern for blocked entry
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([200, 80, 200, 80, 400]);
    } catch {
      // ignore
    }
  }
}
