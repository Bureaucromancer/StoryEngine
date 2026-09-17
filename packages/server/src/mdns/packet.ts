// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Just enough DNS wire format to answer for one name —
 * [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md), [P10.0].
 *
 * ***Hand-written rather than a dependency, and the reason is scope rather than
 * pride.*** An mDNS library brings service discovery, browsing, TXT records,
 * SRV records, conflict arbitration across a record set and a cache — and what
 * [09 §5.1] asks for is one sentence: *"advertise over mDNS as
 * `storyengine.local` once bound beyond loopback, so nobody types an IP."* One
 * host, one A record, one name. The encoder below is the whole of what that
 * needs, and it is a hundred lines of `DataView` against a format fixed in 1987.
 *
 * ***The other half of the argument is the supply chain.*** [19 §10] makes the
 * dependency licence manifest a shipped artefact, and a package that opens a
 * multicast socket and parses attacker-shaped bytes off the local network is
 * exactly the kind of dependency worth not having. What is here parses the same
 * bytes, and it is a hundred lines somebody can read.
 *
 * **Only what a responder needs.** Queries are parsed far enough to find the
 * questions; answers are built with one A record. Anything else in a packet —
 * additional sections, other types, compression pointers in an answer we did
 * not write — is skipped rather than understood, because a responder that does
 * not understand something has nothing to say about it.
 */

/** The class every record here carries, with the cache-flush bit where noted. */
const CLASS_IN = 0x0001;
/**
 * RFC 6762 §10.2's cache-flush bit, set on a **response**.
 *
 * *It is not optional politeness.* Without it a neighbour that cached an older
 * answer for this name — a previous run on a different address — keeps both, and
 * the person who moved the server to a new machine reaches the old one until the
 * TTL runs out.
 */
const FLUSH = 0x8000;

export const TYPE_A = 0x0001;
export const TYPE_ANY = 0x00ff;

export interface Question {
  name: string;
  type: number;
  /**
   * RFC 6762 §5.4's unicast-response bit — the top bit of the class.
   *
   * A querier that sets it is asking to be answered directly rather than on the
   * multicast group, which is what a one-shot resolver (`getaddrinfo`, a
   * browser) does. Honouring it is what makes this reachable from a machine that
   * is not running a full mDNS stack.
   */
  wantsUnicast: boolean;
}

export interface Packet {
  id: number;
  /** True for a response, which a responder must ignore except when probing. */
  isResponse: boolean;
  questions: Question[];
  /** Answer records, parsed only far enough to know a name and a type. */
  answers: { name: string; type: number }[];
}

/**
 * Reads a packet, or null for anything malformed.
 *
 * ***Null rather than a throw, and never a partial answer.*** These bytes come
 * off a multicast group that anything on the LAN can write to, so a malformed
 * packet is an ordinary event rather than an error — and the only correct
 * response to one is silence. A throw here would be an unhandled rejection in a
 * socket callback, which is a process ending because a printer said something
 * strange.
 */
export function decode(bytes: Uint8Array): Packet | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 12) return null;

    const id = view.getUint16(0);
    const flags = view.getUint16(2);
    const counts = [view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)];

    let at = 12;
    const questions: Question[] = [];
    for (let n = 0; n < (counts[0] ?? 0); n += 1) {
      const name = readName(bytes, view, at);
      if (name === null) return null;
      at = name.at;
      if (at + 4 > bytes.byteLength) return null;
      const type = view.getUint16(at);
      const klass = view.getUint16(at + 2);
      at += 4;
      questions.push({ name: name.value, type, wantsUnicast: (klass & 0x8000) !== 0 });
    }

    const answers: { name: string; type: number }[] = [];
    // Only the answer section: a probe conflict is an answer, and the other two
    // record sections are somebody else's business.
    for (let n = 0; n < (counts[1] ?? 0); n += 1) {
      const name = readName(bytes, view, at);
      if (name === null) return null;
      at = name.at;
      if (at + 10 > bytes.byteLength) return null;
      const type = view.getUint16(at);
      const length = view.getUint16(at + 8);
      at += 10 + length;
      if (at > bytes.byteLength) return null;
      answers.push({ name: name.value, type });
    }

    return { id, isResponse: (flags & 0x8000) !== 0, questions, answers };
  } catch {
    return null;
  }
}

/**
 * A name, following compression pointers.
 *
 * **Bounded by a pointer budget rather than by trust.** A packet can point at
 * itself, and a decoder that followed pointers until it found a zero byte would
 * hang the process on four bytes any device on the network can send.
 */
function readName(
  bytes: Uint8Array,
  view: DataView,
  start: number,
): { value: string; at: number } | null {
  const labels: string[] = [];
  let at = start;
  let after: number | null = null;
  let hops = 0;

  for (;;) {
    if (at >= bytes.byteLength) return null;
    const length = bytes[at] ?? 0;

    if ((length & 0xc0) === 0xc0) {
      if (at + 2 > bytes.byteLength) return null;
      if (++hops > 16) return null;
      const target = view.getUint16(at) & 0x3fff;
      after ??= at + 2;
      at = target;
      continue;
    }

    at += 1;
    if (length === 0) break;
    if (at + length > bytes.byteLength) return null;
    labels.push(new TextDecoder().decode(bytes.subarray(at, at + length)));
    at += length;
  }

  return { value: labels.join('.'), at: after ?? at };
}

/** A name as wire-format labels. No compression: one record has nothing to share. */
function writeName(name: string): Uint8Array {
  const parts = name.split('.').filter((one) => one !== '');
  const encoder = new TextEncoder();
  const labels = parts.map((one) => encoder.encode(one));
  const size = labels.reduce((total, one) => total + 1 + one.byteLength, 1);
  const out = new Uint8Array(size);

  let at = 0;
  for (const label of labels) {
    out[at] = label.byteLength;
    out.set(label, at + 1);
    at += 1 + label.byteLength;
  }
  out[at] = 0;
  return out;
}

/**
 * An A record response for one name.
 *
 * **`id: 0` and no questions echoed**, which is RFC 6762 §18: an mDNS response
 * is not a reply to a particular query, it is an assertion about a name. A
 * unicast answer keeps the querier's id, and {@link respond} passes it.
 */
export function encodeAnswer(input: {
  name: string;
  address: string;
  ttlSeconds: number;
  id?: number;
}): Uint8Array {
  const name = writeName(input.name);
  const octets = input.address.split('.').map((one) => Number(one));
  if (octets.length !== 4 || octets.some((one) => !Number.isInteger(one) || one < 0 || one > 255)) {
    throw new Error(`not an IPv4 address: ${input.address}`);
  }

  const out = new Uint8Array(12 + name.byteLength + 10 + 4);
  const view = new DataView(out.buffer);

  view.setUint16(0, input.id ?? 0);
  // Response, authoritative. Nothing else: no recursion, no truncation.
  view.setUint16(2, 0x8400);
  view.setUint16(4, 0); // questions
  view.setUint16(6, 1); // answers
  out.set(name, 12);

  let at = 12 + name.byteLength;
  view.setUint16(at, TYPE_A);
  view.setUint16(at + 2, CLASS_IN | FLUSH);
  view.setUint32(at + 4, input.ttlSeconds);
  view.setUint16(at + 8, 4);
  at += 10;
  for (const [n, octet] of octets.entries()) out[at + n] = octet;

  return out;
}

/**
 * A query for one name — used for **probing** ([RFC 6762 §8.1]).
 *
 * ***The probe is what makes this well-behaved rather than merely working.***
 * Claiming a name nobody checked is how two installs on one household both
 * answer for `storyengine.local`, and the person who reaches whichever one wins
 * the race has no way to tell which. `TYPE_ANY` because the question is *does
 * anything at all claim this name*, not *is there an A record*.
 */
export function encodeQuery(name: string, type = TYPE_ANY): Uint8Array {
  const labels = writeName(name);
  const out = new Uint8Array(12 + labels.byteLength + 4);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0);
  view.setUint16(2, 0x0000); // a query, nothing else
  view.setUint16(4, 1);
  out.set(labels, 12);

  const at = 12 + labels.byteLength;
  view.setUint16(at, type);
  view.setUint16(at + 2, CLASS_IN);
  return out;
}
