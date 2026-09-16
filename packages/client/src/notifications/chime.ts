// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The sound — [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * channel 1, and the feature that motivated the whole of §3, [P10.2].
 *
 * ***Synthesised rather than a file, and the reason is not size.*** An audio
 * asset would be a binary in a repository whose every other byte is text, it
 * would need a licence line in a project that takes those seriously
 * ([19 §10](../../../../docs/design/19-tech-stack.md)), and it would have to be
 * fetched — over a LAN, from a server that may be busy generating the turn this
 * is announcing. Two oscillators and an envelope are forty lines, need no
 * network, and are unambiguously ours to ship.
 *
 * ***A fifth and an octave, deliberately quiet.*** [10 §1](../../../../docs/design/10-ui-surfaces.md)'s
 * register is *"a reading application"*, and the case this serves is somebody
 * who walked away from a long generation — so it has to be audible across a room
 * and must not be startling in a quiet house at one in the morning. What that
 * rules out is a square wave, a long tail, and anything that sounds like an
 * alert.
 *
 * ***And the browser will refuse it until somebody has clicked something.***
 * Autoplay policy suspends an `AudioContext` created before any user gesture,
 * which is correct and is not an error to work around: a page that could make
 * noise on load would. {@link playChime} resumes and gives up quietly, because a
 * silent notification is a notification and a thrown exception in a delivery
 * path is not.
 */

/** Held across calls: a context per notification would exhaust the browser's cap. */
let context: AudioContext | null = null;

type AudioContextCtor = new () => AudioContext;

function audioContext(): AudioContext | null {
  if (context !== null) return context;
  const ctor = (globalThis as { AudioContext?: AudioContextCtor }).AudioContext;
  // Absent under jsdom, and absent on a browser old enough not to matter. The
  // honest answer is no sound rather than a shim that pretends.
  if (ctor === undefined) return null;
  try {
    context = new ctor();
    return context;
  } catch {
    return null;
  }
}

/** A note, as a sine with a soft attack and a short decay. */
function tone(at: AudioContext, hz: number, startAt: number, seconds: number, peak: number): void {
  const oscillator = at.createOscillator();
  const gain = at.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = hz;

  // Ramps rather than steps: a gain that jumps to its value clicks, which is
  // the one artefact a listener notices immediately and cannot name.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

  oscillator.connect(gain);
  gain.connect(at.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + seconds + 0.05);
}

/**
 * Plays the chime, or does nothing at all.
 *
 * **Never throws and never rejects.** This is called from a delivery path that
 * also paints a toast and moves a badge, and an exception here would cost those
 * — which would make *the sound is off* into *notifications are broken*.
 */
export function playChime(): void {
  const at = audioContext();
  if (at === null) return;

  try {
    // Suspended is the ordinary state before the first gesture. `resume`
    // returns a promise that rejects when the policy still says no, which is a
    // normal answer rather than a fault.
    if (at.state === 'suspended') void at.resume().catch(() => undefined);

    const now = at.currentTime;
    // E5 then B5 — a rising fifth, which reads as *finished* rather than as
    // *wrong*. Quiet: 0.06 peak is well under a notification sound's usual.
    tone(at, 659.25, now, 0.18, 0.06);
    tone(at, 987.77, now + 0.09, 0.22, 0.05);
  } catch {
    // A context that was closed, or a browser that declined. Silence is fine.
  }
}

/** Forgets the audio context. For tests, and for a sign-out. */
export function resetChime(): void {
  const held = context;
  context = null;
  if (held !== null && held.state !== 'closed') void held.close().catch(() => undefined);
}
