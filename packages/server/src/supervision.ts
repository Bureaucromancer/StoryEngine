// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Whether something will start this process again if it exits —
 * [09 §6.4](../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.6](../../../docs/design/workplan/27-p10-implementation.md), [P10.3].
 *
 * ***The whole of §6.4's first precondition, and it is a question about the
 * **operator's arrangement** rather than about this program.*** *"Docker with
 * `restart: unless-stopped`, systemd, or unraid will bring the process back; a
 * bare `node server.js` will simply exit and the admin who clicked the button
 * now has no server and possibly no shell."*
 *
 * ***So the honest answer is mostly *ask*, and that is the finding rather than
 * a shortcut.*** Nothing inside a container can see its own `restart:` policy —
 * the policy is the daemon's, the container is told nothing about it, and every
 * heuristic people reach for (`PID 1`, `/.dockerenv`, a cgroup path) detects
 * *being in a container*, which is a different question with the opposite
 * failure mode: a `docker run` with no restart policy passes all three and is
 * the exact trap §6.4 is about.
 *
 * **One thing can be detected honestly, and it is systemd.** A unit's process
 * gets `INVOCATION_ID` in its environment, set by systemd itself and not by a
 * shell — and a unit that exits is subject to its `Restart=` directive. That is
 * still not a guarantee (`Restart=no` exists), so it is treated as *supervised*
 * on the grounds that somebody who wrote a unit file has a way to start it
 * again, which is the actual risk §6.4 names: *no server and possibly no
 * shell*.
 *
 * **Everything else says so out loud.** `SE_SUPERVISED` is
 * [P10 §1.2](../../../docs/design/workplan/27-p10-implementation.md)'s rule
 * applied to a second subject — *one documented environment variable rather
 * than a build difference* — and it is set **beside the restart policy**, in
 * `compose.yaml` and in the unraid template, because those are the two files
 * where the policy itself is written. An image that claimed supervision on its
 * own would be claiming something the person who ran it may not have arranged.
 *
 * ***And it is deliberately not a config key.*** A value in `config.json` can be
 * copied to a machine where it is false, and the settings page would offer to
 * edit a fact about the environment. It is also read once: `server.host` is a
 * `restart` key for the same reason and this is stronger — the answer cannot
 * change under a running process without the process ending, which is the event
 * it is about.
 */

export type Supervision =
  /** A unit file: `INVOCATION_ID` is in the environment, set by systemd. */
  | { supervised: true; how: 'systemd' }
  /** `SE_SUPERVISED` is set: compose's `restart:`, unraid, or a hand-written wrapper. */
  | { supervised: true; how: 'declared' }
  /** Nothing said so. A bare `node server.js` lands here, which is the point. */
  | { supervised: false; how: 'none' };

/**
 * The answer for anything that did not start the process — a test harness, an
 * embedding, a tool that builds the services to read them.
 *
 * ***A value rather than a call, because the environment belongs to whoever
 * owns the process.*** `buildServices` used to ask `process.env` itself, so a
 * test's answer depended on the machine it ran on — and on the GitHub runner,
 * which is itself a systemd service, every test server inherited the runner's
 * `INVOCATION_ID` and believed it was supervised. The Linux leg was red for
 * eighteen runs on exactly that. Only `main.ts` reads the environment now.
 */
export const UNSUPERVISED: Supervision = { supervised: false, how: 'none' };

/**
 * Reads the environment, defaulting to *no*.
 *
 * **Default-deny, and it is the one place that matters.** A wrong *no* costs an
 * admin one manual restart they were going to do anyway; a wrong *yes* costs
 * them the server. The asymmetry is the whole argument for asking rather than
 * guessing.
 */
export function supervisionOf(env: Record<string, string | undefined>): Supervision {
  // An empty value is an unset variable — `docker compose`'s `environment:`
  // forwards a host variable that does not exist as an empty string, and 21 §4
  // already states that rule for the config ones.
  const declared = (env['SE_SUPERVISED'] ?? '').trim().toLowerCase();
  if (declared === '1' || declared === 'true' || declared === 'yes') {
    return { supervised: true, how: 'declared' };
  }
  if ((env['INVOCATION_ID'] ?? '').trim() !== '') return { supervised: true, how: 'systemd' };
  return { supervised: false, how: 'none' };
}
