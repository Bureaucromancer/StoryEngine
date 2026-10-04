// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The sound — [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * channel 1, and the feature that motivated the whole of §3, [P10.2].
 *
 * ***Synthesised rather than a file, and the reason is not size.*** An audio
 * asset would be a binary in a repository whose every other byte is text, it
 * would need a licence line in a project that takes those seriously
 * ([20 §10](../../../../docs/design/20-tech-stack.md)), and it would have to be
 * fetched — over a LAN, from a server that may be busy generating the turn this
 * is announcing. Two oscillators and an envelope are forty lines, need no
 * network, and are unambiguously ours to ship.
 *
 * ***Deliberately quiet, whatever the motif.*** [10 §1](../../../../docs/design/10-ui-surfaces.md)'s
 * register is *"a reading application"*, and the case this serves is somebody
 * who walked away from a long generation — so it has to be audible across a room
 * and must not be startling in a quiet house at one in the morning. What that
 * rules out is a square wave, a long tail, and anything that sounds like an
 * alert.
 *
 * ***Four motifs and not one chime*** — [10 §9](../../../../docs/design/10-ui-surfaces.md)'s
 * first bullet, and its reason is the whole reason there is a sound at all:
 * *"turn-complete, message-received, awaiting-input and failed should be tellable
 * apart from another room — which is the entire point of having a sound rather
 * than a toast."* A person who can hear which one it was does not have to come
 * back and look. **The contour carries it rather than the timbre**: rising for
 * something finished, falling for something that failed, so the difference
 * survives a cheap laptop speaker two rooms away where a change of waveform
 * would not.
 *
 * ***And the browser will refuse all of it until somebody has clicked
 * something.*** [10 §9] names this as *"a well-known trap that presents as
 * 'sounds work sometimes'"*: autoplay policy suspends an `AudioContext` created
 * before any user gesture, so the **first** completion sound after a page load is
 * silently dropped unless something unlocked the context earlier.
 * {@link primeAudio} is the deliberate fix that bullet asks for — unlock on the
 * first interaction of the session — and {@link playChime} still gives up
 * quietly, because a silent notification is a notification and a thrown
 * exception in a delivery path is not.
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
 * The four motifs, as `[hz, peak]` pairs played a beat apart.
 *
 * ***Written as data so that adding a class adds a row***, which is the same
 * shape the label catalogue takes and for the same reason: the fifth class
 * arrives with `turn.awaiting-input`, and a `switch` here would be a place to
 * forget it.
 *
 * - **`turn.complete`** — a rising fifth, E5 to B5. *Finished*, and it is the
 *   sound this whole section was written for.
 * - **`turn.failed`** — falling, and a minor third rather than a klaxon. Enough
 *   to know it went wrong without making a person's shoulders go up.
 * - **`artifact.ready`** — two soft high notes, lighter than a turn's: a picture
 *   landing is good news about something already finished.
 * - **`system.notice`** — flat, two of the same note. It is not about the story,
 *   and sounding like the story would be a small lie.
 */
const MOTIFS: Record<string, readonly (readonly [number, number])[]> = {
  'turn.complete': [
    [659.25, 0.06],
    [987.77, 0.05],
  ],
  'turn.failed': [
    [587.33, 0.06],
    [493.88, 0.055],
  ],
  'artifact.ready': [
    [880.0, 0.04],
    [1174.66, 0.035],
  ],
  'system.notice': [
    [523.25, 0.05],
    [523.25, 0.045],
  ],
};

/** What an unknown class gets: the one a completion gets. Generous, and quiet. */
const FALLBACK = MOTIFS['turn.complete'] ?? [];

/**
 * Plays the motif for a notification class, or does nothing at all.
 *
 * **Never throws and never rejects.** This is called from a delivery path that
 * also paints a toast and moves a badge, and an exception here would cost those
 * — which would make *the sound is off* into *notifications are broken*.
 */
export function playChime(notificationClass = 'turn.complete'): void {
  const at = audioContext();
  if (at === null) return;

  try {
    // Suspended is the ordinary state before the first gesture. `resume`
    // returns a promise that rejects when the policy still says no, which is a
    // normal answer rather than a fault.
    if (at.state === 'suspended') void at.resume().catch(() => undefined);

    const now = at.currentTime;
    const motif = MOTIFS[notificationClass] ?? FALLBACK;
    motif.forEach(([hz, peak], at_) => {
      tone(at, hz, now + at_ * 0.09, 0.2, peak);
    });
  } catch {
    // A context that was closed, or a browser that declined. Silence is fine.
  }
}

/**
 * Unlocks the audio context on the first interaction of the session —
 * [10 §9](../../../../docs/design/10-ui-surfaces.md)'s *"prime the audio on
 * first interaction"*.
 *
 * ***The bullet calls this a well-known trap and it is worth restating why it
 * is worse than it sounds.*** Without it the failure is not *no sound* — it is
 * **sound that works sometimes**: a person who clicked something before their
 * first turn finished hears it, and a person who opened a tab and waited does
 * not. That is unreportable, and it reads as the feature being flaky rather
 * than as a policy doing exactly what it says.
 *
 * *Created **and** resumed here*, because constructing the context is itself the
 * thing autoplay policy suspends — a context built on load and resumed later is
 * a context that starts suspended on some browsers and stays that way.
 *
 * Returns a function that detaches, and the listeners are `once`, so priming
 * costs one event per page load.
 */
export function primeAudio(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const unlock = (): void => {
    const at = audioContext();
    if (at !== null && at.state === 'suspended') void at.resume().catch(() => undefined);
  };

  // Pointer **and** key, because somebody driving this from the keyboard is
  // exactly the person who will not click anything before their first turn.
  const events = ['pointerdown', 'keydown'] as const;
  for (const name of events) document.addEventListener(name, unlock, { once: true });

  return () => {
    for (const name of events) document.removeEventListener(name, unlock);
  };
}

/** Forgets the audio context. For tests, and for a sign-out. */
export function resetChime(): void {
  const held = context;
  context = null;
  if (held !== null && held.state !== 'closed') void held.close().catch(() => undefined);
}
