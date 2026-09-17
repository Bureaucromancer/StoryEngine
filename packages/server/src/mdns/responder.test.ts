// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { advertise, primaryAddress } from './responder.js';

/**
 * The responder — [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.0].
 *
 * ***What can be asserted here is that it never costs anything***, which is the
 * claim that actually matters: mDNS is a convenience, and a convenience must
 * never be able to stop the thing it is a convenience for. macOS runs
 * `mDNSResponder` and most Linux desktops run Avahi — **both hold port 5353** —
 * and a container may have no multicast route at all. Every one of those is
 * *no `.local` name*, and none of them is *no server*.
 *
 * ***What cannot be asserted here is that a neighbour hears it.*** That needs a
 * second machine on a real network, and it is [P10's gate](../../../../docs/design/workplan/27-p10-implementation.md)'s
 * — *somebody on the LAN reaching the install by name rather than by address*.
 * The bytes that would reach them are `packet.test.ts`'s, exactly; what is
 * between the bytes and the neighbour is a socket, and a socket is what a person
 * with two machines checks.
 */

describe('an address to answer with', () => {
  it('is an IPv4 address or nothing, and never a loopback one', () => {
    const address = primaryAddress();
    if (address === null) return;

    // Four octets, and not `127.*` — answering `storyengine.local` with
    // loopback would send every neighbour to their own machine.
    expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(address.startsWith('127.')).toBe(false);
  });
});

describe('advertising nothing', () => {
  /**
   * **The empty name is *off*** — one config key doing two jobs, because a
   * separate boolean would be a second thing to keep in step with a value that
   * already has an obvious *nothing*.
   */
  it('does nothing at all for an empty name, without touching a socket', async () => {
    const lines: Record<string, unknown>[] = [];
    const handle = await advertise({ name: '   ', log: (event) => lines.push(event) });

    expect(handle.name).toBeNull();
    expect(lines[0]?.['event']).toBe('mdns.skipped');
    // Stopping something that never started is a no-op rather than an error.
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('does nothing when there is no address to answer with', async () => {
    // No `address` key at all rather than `address: undefined` —
    // `exactOptionalPropertyTypes` is on, and the two are different things here
    // on purpose: absent means *work it out*, and there is no value meaning
    // *do not*.
    const handle = await advertise({ name: 'storyengine', log: () => undefined });
    // On a machine with no non-internal interface this is the skip path; on one
    // with an interface it is a real attempt. Either way it answers rather than
    // throwing, which is the assertion.
    expect(handle.name === null || handle.name === 'storyengine.local').toBe(true);
    await handle.stop();
  });
});

describe('when the network will not have it', () => {
  /**
   * ***The case this is really written for.*** A port somebody else holds, no
   * multicast route, a firewall: the honest answer is a log line and a `null`
   * name, and the server carries on listening.
   *
   * *Driven with a real call rather than a mock*, because what is being asserted
   * is that **nothing escapes** — and a mock that returned a rejection would be
   * asserting about the mock.
   */
  it('answers rather than throwing, whatever the machine says', async () => {
    const lines: Record<string, unknown>[] = [];
    const handle = await advertise({
      name: 'storyengine-test',
      address: '192.0.2.1',
      log: (event) => lines.push(event),
    });

    // One of the three outcomes, and every one of them is a resolved promise:
    // claimed, taken by a neighbour, or the socket was not available.
    expect(['mdns.claimed', 'mdns.taken', 'mdns.unavailable']).toContain(lines.at(-1)?.['event']);
    await expect(handle.stop()).resolves.toBeUndefined();
    // Idempotent, because shutdown can reach it from more than one direction.
    await expect(handle.stop()).resolves.toBeUndefined();
  }, 10_000);
});
