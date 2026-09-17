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

describe('what counts as supervised', () => {
  it('takes systemd’s own variable', () => {
    // Set by systemd for a unit's process, not by a shell — which is what makes
    // it worth trusting where a container heuristic is not.
    expect(supervisionOf({ INVOCATION_ID: 'a3f2' })).toEqual({
      supervised: true,
      how: 'systemd',
    });
  });

  it('takes an operator’s word, in the spellings an operator writes', () => {
    for (const value of ['1', 'true', 'yes', 'TRUE', ' yes ']) {
      expect(supervisionOf({ SE_SUPERVISED: value }).supervised, value).toBe(true);
    }
  });

  /**
   * ***`docker compose`'s `environment: [SE_SUPERVISED]` forwards a host
   * variable that does not exist as an empty string*** — 21 §4's rule for the
   * config variables, and it matters more here: an empty value read as a yes
   * would offer the trap to exactly the deployment that cannot survive it.
   */
  it('reads an empty value as unset', () => {
    expect(supervisionOf({ SE_SUPERVISED: '', INVOCATION_ID: '' })).toEqual({
      supervised: false,
      how: 'none',
    });
  });

  it('says no to everything else, including a plain no', () => {
    expect(supervisionOf({})).toEqual({ supervised: false, how: 'none' });
    expect(supervisionOf({ SE_SUPERVISED: '0' }).supervised).toBe(false);
    expect(supervisionOf({ SE_SUPERVISED: 'false' }).supervised).toBe(false);
    /**
     * **The trap, named.** Every container heuristic — PID 1, `/.dockerenv`, a
     * cgroup path — is true of `docker run` with no restart policy, which is
     * the exact deployment [09 §6.4] is warning about. So none of them is read,
     * and a container says so beside its `restart:` line instead.
     */
    expect(supervisionOf({ container: 'docker', HOSTNAME: 'abc123' }).supervised).toBe(false);
  });
});
