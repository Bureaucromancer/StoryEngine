// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { supervisionOf } from './supervision.js';

/**
 * Whether *Restart now* is offered — [09 §6.4], [P10.3].
 *
 * ***The asymmetry is the whole test.*** A wrong *no* costs an admin one manual
 * restart they were going to do anyway; a wrong *yes* costs them the server and
 * possibly their shell. So every case that is not an explicit yes is a no, and
 * the cases worth writing down are the ones that **look** like a yes.
 */

/** The process under test, as `main.ts` passes `process.pid`. */
const PID = 4242;

describe('what counts as supervised', () => {
  it('takes systemd’s own variables, for the process systemd started', () => {
    // Set by systemd for a unit's process, not by a shell — which is what makes
    // them worth trusting where a container heuristic is not.
    expect(supervisionOf({ INVOCATION_ID: 'a3f2', SYSTEMD_EXEC_PID: '4242' }, PID)).toEqual({
      supervised: true,
      how: 'systemd',
    });
  });

  /**
   * ***The variable a unit's process hands to everything it starts.*** A
   * GitHub runner is a systemd service, and every test server it started read
   * its `INVOCATION_ID` as a supervisor. So did a server started by hand from a
   * tmux whose server a user unit started. `SYSTEMD_EXEC_PID` names the one
   * process systemd started, and a descendant is not it.
   *
   * Catches: dropping the pid comparison, which turns the first case back into
   * a yes.
   */
  it('does not take systemd’s word for a process systemd did not start', () => {
    expect(supervisionOf({ INVOCATION_ID: 'a3f2', SYSTEMD_EXEC_PID: '17' }, PID)).toEqual({
      supervised: false,
      how: 'none',
    });
    // systemd before 248 sets only the first, and a guess is the costly way
    // round. The shipped unit declares instead, so it does not reach this.
    expect(supervisionOf({ INVOCATION_ID: 'a3f2' }, PID).supervised).toBe(false);
  });

  it('takes an operator’s word, in the spellings an operator writes', () => {
    for (const value of ['1', 'true', 'yes', 'TRUE', ' yes ']) {
      expect(supervisionOf({ SE_SUPERVISED: value }, PID).supervised, value).toBe(true);
    }
  });

  /**
   * ***A no is an answer, and it outranks a detection.*** An operator whose
   * unit says `Restart=no` knows what systemd will do better than a variable
   * does. `SE_SUPERVISED=0` used to fall through to the detection and be
   * overruled by it.
   */
  it('takes an operator’s no over systemd’s yes', () => {
    for (const value of ['0', 'false', 'no', ' NO ']) {
      const systemd = { INVOCATION_ID: 'a3f2', SYSTEMD_EXEC_PID: '4242', SE_SUPERVISED: value };
      expect(supervisionOf(systemd, PID).supervised, value).toBe(false);
    }
  });

  /**
   * ***`docker compose`'s `environment: [SE_SUPERVISED]` forwards a host
   * variable that does not exist as an empty string*** — 22 §4's rule for the
   * config variables, and it matters more here: an empty value read as a yes
   * would offer the trap to exactly the deployment that cannot survive it.
   */
  it('reads an empty value as unset', () => {
    expect(supervisionOf({ SE_SUPERVISED: '', INVOCATION_ID: '' }, PID)).toEqual({
      supervised: false,
      how: 'none',
    });
  });

  it('says no to everything else, including a plain no', () => {
    expect(supervisionOf({}, PID)).toEqual({ supervised: false, how: 'none' });
    expect(supervisionOf({ SE_SUPERVISED: '0' }, PID).supervised).toBe(false);
    expect(supervisionOf({ SE_SUPERVISED: 'false' }, PID).supervised).toBe(false);
    /**
     * **The trap, named.** Every container heuristic — PID 1, `/.dockerenv`, a
     * cgroup path — is true of `docker run` with no restart policy, which is
     * the exact deployment [09 §6.4] is warning about. So none of them is read,
     * and a container says so beside its `restart:` line instead.
     */
    expect(supervisionOf({ container: 'docker', HOSTNAME: 'abc123' }, PID).supervised).toBe(false);
  });
});
