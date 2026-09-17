// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

import { decode, encodeAnswer, encodeQuery, TYPE_A, TYPE_ANY } from './packet.js';

/**
 * `storyengine.local`, so nobody types an IP —
 * [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md), [P10.0].
 *
 * ***"Small feature, large effect on whether non-technical household members
 * ever use it."*** That sentence is the whole justification and it is worth
 * keeping in view, because everything below is plumbing in service of somebody
 * typing a word instead of four numbers they were told over a phone.
 *
 * ---
 *
 * ***Only once bound beyond loopback***, which is §5.1's condition rather than a
 * setting: an install reachable only from its own machine has nobody to
 * advertise to, and `localhost` already works. So the responder is started by
 * the same check that decides whether a setup token is needed.
 *
 * ***It probes before it claims, and that is what makes it well-behaved rather
 * than merely working*** ([RFC 6762 §8.1]). Two installs in one household both
 * answering for `storyengine.local` is a race whose winner nobody can identify,
 * and the person who reaches the wrong one has no way to tell. Three queries,
 * 250 ms apart; anything that answers means the name is taken and this install
 * advertises nothing — loudly, in the log, with the name it tried.
 *
 * ***And it says goodbye.*** A TTL-zero answer on shutdown tells the network to
 * forget the name now rather than in two minutes, which is the difference
 * between restarting a server and a household reaching a dead address for the
 * length of a cache entry.
 *
 * ***Every failure is silence rather than an exception.*** A container with no
 * multicast route, a host where something already holds port 5353 (an Avahi
 * daemon, a Bonjour responder — both extremely likely), a firewall: each of
 * those means *no `.local` name*, and none of them means *no server*. The
 * feature is a convenience and it must never be able to stop the thing it is a
 * convenience for.
 */

const GROUP = '224.0.0.251';
const PORT = 5353;

/** RFC 6762 §10: two minutes for a hostname record, in seconds. */
const TTL_SECONDS = 120;

/** RFC 6762 §8.1: three probes, 250 ms apart, before a name is claimed. */
const PROBES = 3;
const PROBE_GAP_MS = 250;

export interface MdnsOptions {
  /** The label before `.local` — `storyengine` gives `storyengine.local`. */
  name: string;
  /** The address to answer with. Resolved from the interfaces when absent. */
  address?: string;
  log?: (event: Record<string, unknown>, message: string) => void;
}

export interface MdnsHandle {
  /** The name actually claimed, or null when nothing was. */
  readonly name: string | null;
  stop: () => Promise<void>;
}

/**
 * The first non-internal IPv4 address on this machine.
 *
 * ***A responder has to answer with **an** address and there may be several***
 * — a wired interface, a wireless one, a container bridge. This takes the first
 * the OS lists, which is the same heuristic every other small responder uses and
 * is right often enough to be worth having: the alternative is answering with
 * all of them, which a one-shot resolver will happily try in an order nobody
 * chose, or a config key for a question an operator cannot answer before the
 * first time it goes wrong.
 */
export function primaryAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const one of addresses ?? []) {
      if (one.family === 'IPv4' && !one.internal) return one.address;
    }
  }
  return null;
}

/**
 * Starts advertising, having first checked that nobody else is.
 *
 * Resolves once the name is claimed **or** refused, so a caller that awaits it
 * knows which — and a caller that does not await it costs nothing, because
 * everything after the probe is a socket callback.
 */
export async function advertise(options: MdnsOptions): Promise<MdnsHandle> {
  const log = options.log ?? (() => undefined);
  const label = options.name.trim();
  const name = `${label}.local`;
  const address = options.address ?? primaryAddress();

  if (label === '' || address === null) {
    log({ event: 'mdns.skipped', name, address }, 'Not advertising: no name or no address');
    return { name: null, stop: () => Promise.resolve() };
  }

  let socket: Socket;
  try {
    socket = createSocket({ type: 'udp4', reuseAddr: true });
  } catch (error) {
    log({ event: 'mdns.unavailable', err: error }, 'Not advertising: no socket');
    return { name: null, stop: () => Promise.resolve() };
  }

  /**
   * **Bound before anything is sent**, because a probe with no bound socket
   * gets an ephemeral port and the answers come back somewhere nobody is
   * listening — which reads as *the name is free* whatever is out there.
   */
  const bound = await bind(socket, log);
  if (!bound) return { name: null, stop: () => Promise.resolve() };

  /**
   * ***The probe's two flags, in an object rather than as two `let`s.***
   *
   * Not a style choice: both are written from inside a socket callback and read
   * from the loop below, and TypeScript's control-flow analysis cannot see the
   * callback — so as locals it narrows `taken` to `false` at every read and the
   * lint rule reports the check as *always falsy*, which would be true of the
   * types and false of the program. A field is not narrowed, so what the
   * compiler believes and what happens agree.
   */
  const state = { claimed: false, taken: false };

  socket.on('message', (bytes: Buffer, from: { address: string; port: number }) => {
    const packet = decode(bytes);
    if (packet === null) return;

    /**
     * **During the probe, any answer for this name means it is taken.** After
     * it, a response is somebody else's assertion and none of this responder's
     * business — it holds one record and does not cache.
     */
    if (packet.isResponse) {
      if (!state.claimed && packet.answers.some((one) => equalNames(one.name, name))) {
        state.taken = true;
      }
      return;
    }

    if (!state.claimed) return;
    const asked = packet.questions.find(
      (one) => equalNames(one.name, name) && (one.type === TYPE_A || one.type === TYPE_ANY),
    );
    if (asked === undefined) return;

    const answer = encodeAnswer({
      name,
      address,
      ttlSeconds: TTL_SECONDS,
      // A unicast answer is a reply and keeps the querier's id; a multicast one
      // is an assertion and carries none — RFC 6762 §18.
      ...(asked.wantsUnicast ? { id: packet.id } : {}),
    });

    // **Honouring the unicast bit is what makes this reachable from a machine
    // running no mDNS stack**: a one-shot resolver asks for a direct reply, and
    // a responder that always multicast would answer a question nobody heard.
    const [to, port] = asked.wantsUnicast ? [from.address, from.port] : [GROUP, PORT];
    socket.send(answer, port, to, () => undefined);
  });

  for (let n = 0; n < PROBES; n += 1) {
    if (state.taken) break;
    socket.send(encodeQuery(name), PORT, GROUP, () => undefined);
    await delay(PROBE_GAP_MS);
  }

  if (state.taken) {
    log({ event: 'mdns.taken', name }, 'Not advertising: that name is already claimed here');
    await close(socket);
    return { name: null, stop: () => Promise.resolve() };
  }

  state.claimed = true;
  // The unsolicited announcement, so a resolver that is already listening does
  // not have to ask. RFC 6762 §8.3 wants two; one plus answering queries is the
  // part that matters, and a second is cheap.
  const announcement = encodeAnswer({ name, address, ttlSeconds: TTL_SECONDS });
  socket.send(announcement, PORT, GROUP, () => undefined);
  log({ event: 'mdns.claimed', name, address }, `Advertising as ${name}`);

  let stopped = false;
  return {
    name,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      state.claimed = false;
      /**
       * ***The goodbye*** — RFC 6762 §10.1. A TTL-zero answer tells the network
       * to forget the name now rather than in two minutes, which is the
       * difference between restarting a server and a household reaching a dead
       * address for the length of a cache entry.
       */
      await new Promise<void>((resolve) => {
        socket.send(encodeAnswer({ name, address, ttlSeconds: 0 }), PORT, GROUP, () => {
          resolve();
        });
      }).catch(() => undefined);
      await close(socket);
    },
  };
}

/**
 * Binds to the mDNS port and joins the group, or answers false.
 *
 * ***False is the ordinary case on a great many machines and is not a fault.***
 * macOS runs `mDNSResponder` and most Linux desktops run Avahi; both hold 5353,
 * and `reuseAddr` lets this share it where the platform allows and not where it
 * does not. An install on such a machine is already reachable by name **through
 * that daemon**, which is better than what this would have done.
 */
function bind(
  socket: Socket,
  log: (event: Record<string, unknown>, message: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    socket.once('error', (error) => {
      log({ event: 'mdns.unavailable', err: error }, 'Not advertising: the mDNS port is not free');
      socket.close();
      resolve(false);
    });
    socket.bind(PORT, () => {
      try {
        socket.addMembership(GROUP);
        // Loopback on, so a resolver on this same machine hears the answer —
        // which is the case somebody debugging this will try first.
        socket.setMulticastLoopback(true);
        socket.setMulticastTTL(255);
        resolve(true);
      } catch (error) {
        log({ event: 'mdns.unavailable', err: error }, 'Not advertising: no multicast route');
        socket.close();
        resolve(false);
      }
    });
  });
}

function close(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never the reason a process stays alive — every other timer here follows
    // the same rule, and a name service least of all.
    timer.unref();
  });
}

/** DNS names are case-insensitive, and a querier may not agree about the case. */
function equalNames(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
