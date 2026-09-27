// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { remedyFor } from './remedy.js';

/**
 * ***The assertion this stage exists for is an absence***, which is why the
 * table below is written the way it is —
 * [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P11.6](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §6.5 says *"a fully local setup is a legitimate, fully-functional deployment
 * and its operator chose it deliberately"*, and the failure mode a happy-path
 * test would never see is telling that operator their internet is down. **A
 * dead container on `localhost:11434` and a severed uplink produce the identical
 * `ECONNREFUSED`**, so the only thing standing between the two is the order
 * `remedyFor` asks its questions in — and an order is exactly the kind of thing
 * that gets quietly reversed by somebody tidying.
 *
 * So the local cases below are asserted **against every value of `online`**,
 * including `false`. That is the test: an install whose endpoints are all on the
 * LAN is told nothing about the internet even while this server knows perfectly
 * well that it has none.
 */

describe('a local endpoint is never told about the internet', () => {
  it('says the model server is down, whatever connectivity says', () => {
    for (const online of [true, false, null]) {
      expect(remedyFor({ reason: 'transient', endpoint: 'local', online })).toBe(
        'endpoint-silent-local',
      );
    }
  });
});

describe('a remote endpoint that nothing answered', () => {
  it('says the server is offline only when a check established that', () => {
    expect(remedyFor({ reason: 'transient', endpoint: 'remote', online: false })).toBe(
      'endpoint-silent-offline',
    );
  });

  /**
   * ***The distinction [P10.3] paid for.*** An HTTP answer this build cannot
   * use — the 404 the private release feed returns — **proves the internet
   * works**, so a failure against a remote endpoint after that is about the
   * endpoint rather than about the network. Reporting it as *offline* would send
   * an admin to their router while the address is the thing that is wrong.
   */
  it('blames the endpoint when the internet is known to work', () => {
    expect(remedyFor({ reason: 'transient', endpoint: 'remote', online: true })).toBe(
      'endpoint-silent-online',
    );
  });

  it('claims neither when nothing has looked', () => {
    expect(remedyFor({ reason: 'transient', endpoint: 'remote', online: null })).toBe(
      'endpoint-silent',
    );
  });
});

describe('what a reader with only the class can say', () => {
  /**
   * The transcript's case: a turn that failed last week, whose record holds the
   * class and neither the address nor that day's connectivity. It must land on
   * the arm that says less rather than on `engine`, which would be a claim that
   * this build did something wrong.
   */
  it('degrades to saying nothing about where', () => {
    expect(remedyFor({ reason: 'transient', online: null })).toBe('endpoint-silent');
    expect(remedyFor({ reason: 'transient', online: false })).toBe('endpoint-silent');
  });
});

describe('the endpoint answered', () => {
  it('separates busy from refused, and refused from silence after acceptance', () => {
    expect(remedyFor({ reason: 'retryable', endpoint: 'remote', online: true })).toBe(
      'endpoint-busy',
    );
    expect(remedyFor({ reason: 'terminal', endpoint: 'remote', online: true })).toBe(
      'endpoint-refused',
    );
    // Both are `terminal` to the retry ladder and they are opposite remedies:
    // one is *change something*, the other is *the request is still in there
    // somewhere*.
    expect(remedyFor({ reason: 'terminal', endpoint: 'remote', stalled: true, online: true })).toBe(
      'endpoint-stalled',
    );
  });
});

describe('the failures that are not about a network at all', () => {
  /**
   * **Asserted against `online: false`, for the local endpoint's reason.** An
   * unbound role on a server with no internet is still an unbound role, and a
   * sentence about the internet would send somebody to fix the one thing that
   * is not broken.
   */
  it('sends a configuration fault to the bindings and not to the network', () => {
    expect(remedyFor({ reason: 'unbound', online: false })).toBe('not-bound');
    expect(remedyFor({ reason: 'dangling', online: false })).toBe('not-bound');
  });

  /**
   * *A window too small for the reply is a setting, and nothing was sent*
   * (2026-09-27): neither the bindings (the model resolved) nor the endpoint
   * (it was never asked) is the place to look.
   */
  it('sends a window too small for the reply to its own remedy', () => {
    expect(remedyFor({ reason: 'window-too-small', online: false })).toBe('window-too-small');
  });

  it('owns the engine faults rather than blaming the endpoint', () => {
    for (const reason of ['advisory-leak', 'internal', 'cancelled'] as const) {
      expect(remedyFor({ reason, endpoint: 'remote', online: false })).toBe('engine');
    }
  });
});
