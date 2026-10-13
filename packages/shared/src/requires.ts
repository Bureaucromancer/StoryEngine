// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***What a World asks of an install that the install does not have*** —
 * [04 §9](../../../docs/design/04-schemas.md),
 * [03 §7.2](../../../docs/design/03-data-model.md), and **the owner's answer of
 * 2026-10-13** to the question the [P16](../../../docs/design/workplan/34-p16-world.md)
 * final audit left open — *"Build the promise, or narrow the notes"*: build
 * it. `requires` is checked, each unmet requirement is said, and a session
 * whose World or Setup wants what this install lacks can be **started
 * anyway** rather than refused.
 *
 * ***Shared, because both sides read one list.*** The server sends it twice —
 * in the `422 unmet-requirements` a start is refused with, and on the session
 * started anyway as `startedWithout` — and the client words each item from it
 * (`play/StartAnyway.tsx`). A list each side spelled for itself would let the
 * dialog say one thing and the session's record another. Pure types, per this
 * package's rule: the checking is the server's (`requires.ts` there), because
 * only the server knows which modes are installed and which roles resolve.
 *
 * **One shape per kind, and each carries what its sentence needs** — the
 * server never sends prose, so a renderer cannot go back for more:
 *
 * - **`mode`** — absent (`installed: null`) or older than `minVersion`.
 *   `minVersion` is absent when nobody stated one: a Setup names its mode by id
 *   alone (`Setup.mode` has no version), and the versions a World file's
 *   manifest derives are not kept when it lands, so only a World's *authored*
 *   `requires` can say *at least 2*. **`substituted`** marks the one mode the
 *   session itself would play — its Setup's — when it is absent: started
 *   anyway, the session plays the default mode in its place, which is a
 *   different thing to tell somebody than *a mode the World also asks for*.
 * - **`capability`** — ***the vocabulary is the model roles***, the lead's
 *   decision of 2026-10-13, recorded in 04 §9 and open to the owner's reversal.
 *   A string that is one of `MODEL_ROLES` (`prose`, `image`, …) is met when that
 *   role resolves for the account, exactly as `GET /me/roles` resolves it; it
 *   arrives here unmet with `checkable: true`. **Any other string is
 *   `checkable: false`**: named, and treated as not known to be met — the build
 *   cannot ask what `"audio"` means, and saying nothing would be the silent
 *   pass 04 §9 was struck for.
 * - **`extension`** — ***unmet by construction***. This build loads no
 *   extensions and has no registry to ask, so every extension a World names is
 *   one it does not have. That is said as exactly that, never as *checked and
 *   missing*.
 */
export type UnmetRequirement =
  | {
      kind: 'mode';
      id: string;
      minVersion?: string;
      installed: string | null;
      substituted?: true;
    }
  | { kind: 'capability'; id: string; checkable: boolean }
  | { kind: 'extension'; id: string; minVersion: string };

/**
 * ***What a session was started without*** — written once, at creation, on a
 * session started with `degraded: true` past a `422 unmet-requirements`
 * (`POST /api/sessions`), and never after.
 *
 * **On the record rather than in a log line** ([06 §4.2]'s rule for a degraded
 * session: *a persistent banner on that session, not a modal and not a log
 * line*). A session started in Scene because its Setup's mode is not installed
 * is still somebody's story, and the reason it plays as it does belongs on its
 * page, where the person who started it — or whoever it is sent to next — can
 * see why. `at` is when it was started; the list is the refusal's, as the
 * person was shown it.
 *
 * *Absent on every other session*, including one sent `degraded: true` that
 * lacked nothing: a flag with nothing to forgo starts the session exactly as
 * it would have started without it.
 */
export interface StartedWithout {
  at: string;
  unmet: UnmetRequirement[];
}

/** The refusal class `POST /api/sessions` answers when something is unmet and `degraded` was not sent. */
export const UNMET_REQUIREMENTS = 'unmet-requirements';
