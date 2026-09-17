// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { decode, encodeAnswer, encodeQuery, TYPE_A, TYPE_ANY } from './packet.js';

/**
 * The wire format — [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.0].
 *
 * ***The encoder and the decoder are pure, which is the whole reason they are a
 * separate module.*** Everything interesting about a responder that cannot be
 * tested without a network — a multicast route, a port somebody else holds, a
 * neighbour that answers — is in `responder.ts`; **what can be tested exactly is
 * whether the bytes are right**, and bytes are what a printer on the same
 * network will send back.
 *
 * ***The decoder is the half that faces hostile input.*** These bytes come off a
 * multicast group anything on the LAN can write to, so the cases worth writing
 * down are the malformed ones — and the answer to every one of them is `null`
 * and silence, never a throw in a socket callback.
 */

function roundTrip(name: string, address: string) {
  const packet = decode(encodeAnswer({ name, address, ttlSeconds: 120 }));
  if (packet === null) throw new Error('the encoder produced something undecodable');
  return packet;
}

describe('an answer', () => {
  it('round-trips its name and says it is a response', () => {
    const packet = roundTrip('storyengine.local', '192.168.1.50');

    expect(packet.isResponse).toBe(true);
    expect(packet.answers).toEqual([{ name: 'storyengine.local', type: TYPE_A }]);
    // **No questions echoed** — RFC 6762 §18: an mDNS response is an assertion
    // about a name rather than a reply to a particular query.
    expect(packet.questions).toEqual([]);
  });

  /**
   * ***RFC 6762 §10.2's cache-flush bit, and it is not optional politeness.***
   * Without it a neighbour that cached an older answer for this name — a
   * previous run on a different address — keeps both, and the person who moved
   * the server reaches the old one until the TTL runs out.
   */
  it('sets the cache-flush bit on the record class', () => {
    const bytes = encodeAnswer({ name: 'storyengine.local', address: '10.0.0.4', ttlSeconds: 120 });
    const view = new DataView(bytes.buffer);
    // 12 header + 1+11 'storyengine' + 1+5 'local' + 1 root = 31, then type.
    const classAt = 12 + 'storyengine'.length + 1 + 'local'.length + 1 + 1 + 2;
    expect(view.getUint16(classAt) & 0x8000).toBe(0x8000);
  });

  it('writes the address it was given, and a goodbye with no TTL', () => {
    const bytes = encodeAnswer({ name: 'a.local', address: '192.168.1.50', ttlSeconds: 0 });
    const view = new DataView(bytes.buffer);
    const ttlAt = 12 + 1 + 1 + 1 + 5 + 1 + 4;

    expect(view.getUint32(ttlAt)).toBe(0);
    expect([...bytes.subarray(bytes.byteLength - 4)]).toEqual([192, 168, 1, 50]);
  });

  it('refuses an address that is not one rather than writing nonsense', () => {
    for (const address of ['', 'localhost', '1.2.3', '1.2.3.4.5', '256.0.0.1']) {
      expect(() => encodeAnswer({ name: 'a.local', address, ttlSeconds: 1 }), address).toThrow();
    }
  });
});

describe('a query', () => {
  it('asks for anything at all under that name', () => {
    const packet = decode(encodeQuery('storyengine.local'));

    // `ANY` because a probe asks *does anything claim this name*, not *is there
    // an A record* — RFC 6762 §8.1.
    expect(packet?.questions).toEqual([
      { name: 'storyengine.local', type: TYPE_ANY, wantsUnicast: false },
    ]);
    expect(packet?.isResponse).toBe(false);
  });

  /**
   * ***RFC 6762 §5.4's unicast-response bit, which is what makes this reachable
   * from a machine running no mDNS stack.*** A one-shot resolver —
   * `getaddrinfo`, a browser — asks to be answered directly, and a responder
   * that always multicast would be answering a question nobody heard.
   */
  it('reads the unicast bit off the question class', () => {
    const bytes = encodeQuery('storyengine.local', TYPE_A);
    const view = new DataView(bytes.buffer);
    const classAt = bytes.byteLength - 2;
    view.setUint16(classAt, view.getUint16(classAt) | 0x8000);

    expect(decode(bytes)?.questions[0]?.wantsUnicast).toBe(true);
  });
});

describe('what comes off the network', () => {
  it('reads a compressed name, which every real querier writes', () => {
    // Two questions where the second points at the first — the ordinary
    // encoding, and the one a hand-rolled decoder gets wrong.
    const first = encodeQuery('storyengine.local', TYPE_A);
    const bytes = new Uint8Array(first.byteLength + 6);
    bytes.set(first);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 2);
    // A pointer to offset 12, which is where the first name starts.
    view.setUint16(first.byteLength, 0xc00c);
    view.setUint16(first.byteLength + 2, TYPE_A);
    view.setUint16(first.byteLength + 4, 1);

    const packet = decode(bytes);
    expect(packet?.questions.map((one) => one.name)).toEqual([
      'storyengine.local',
      'storyengine.local',
    ]);
  });

  /**
   * ***A packet can point at itself***, and a decoder that followed pointers
   * until it found a zero byte would hang the process on four bytes any device
   * on the network can send. **The bound is a pointer budget rather than
   * trust.**
   */
  it('does not follow a pointer loop forever', () => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1); // one question
    view.setUint16(12, 0xc00c); // …whose name points at itself

    expect(decode(bytes)).toBeNull();
  });

  it('answers null for every shape of malformed, rather than throwing', () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array(11),
      // A header claiming a question that is not there.
      Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
      // A label longer than what follows it.
      Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 40, 97]),
    ]) {
      expect(() => decode(bytes)).not.toThrow();
      expect(decode(bytes)).toBeNull();
    }
  });
});
