// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Parsing an SSE byte stream into frames — the pure half of the transport.
 *
 * Separate from the connector so the fiddly part is testable without a network,
 * a server or a fake: frames arrive split across arbitrary chunk boundaries, and
 * that is exactly the case a component test would never reproduce reliably.
 */

export interface SseFrame {
  event: string;
  id?: string;
  data: unknown;
}

/**
 * Feeds bytes in, gets whole frames out.
 *
 * Stateful because it has to be — a frame is delimited by a blank line and a
 * chunk boundary lands wherever the network put it, so a parser that could not
 * hold a partial frame would drop every message split across two reads.
 */
export class SseParser {
  #buffer = '';

  push(text: string): SseFrame[] {
    this.#buffer += text;
    const frames: SseFrame[] = [];

    let at = this.#buffer.indexOf('\n\n');
    while (at !== -1) {
      const raw = this.#buffer.slice(0, at);
      this.#buffer = this.#buffer.slice(at + 2);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
      at = this.#buffer.indexOf('\n\n');
    }

    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    // A comment — the keepalive. Nothing to hand up.
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }

  if (data.length === 0) return null;

  const text = data.join('\n');
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A frame whose data is not JSON is still a frame. Reporting it lets the
    // caller decide, rather than losing it here.
  }
  return { event, ...(id === undefined ? {} : { id }), data: parsed };
}
