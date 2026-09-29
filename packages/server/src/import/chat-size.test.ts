// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Turn } from '@storyengine/shared';

import { exportSession } from '../sessions/export.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { importChatFile } from './chat-sessions.js';

/**
 * ***A 10,000-message chat, through the one-file door*** —
 * [P13.12](../../../../docs/design/workplan/30-p13-scene-and-session-import.md):
 * *"one 10,000-message size test, because nobody has measured `importSession`
 * turn by turn"*.
 *
 * SillyTavern chats run long — a year of evenings with one card is thousands
 * of lines — and every fixture before this one was tens of lines, so nothing
 * said whether the import was linear, or whether the session it made could be
 * opened afterwards. `turns/warm-summaries.test.ts` stops at 240 lines, which
 * is the size a summary chain needs, not the size a person has.
 *
 * ***Measured before the bound was set*** (2026-09-29, a 4-core Linux
 * container, load average 1–3 with another workflow's suite running beside
 * it), each size in a fresh install, one chat of alternating lines with a
 * greeting first, so a chat is half its messages plus one in turns, in one
 * unbranched line:
 *
 * | messages | turns  | `importChatFile` | of which `importSession` | open (`GET` session) |
 * |---------:|-------:|-----------------:|-------------------------:|---------------------:|
 * |    2,500 |  1,251 |            1.4 s |                    1.4 s |               0.25 s |
 * |    5,000 |  2,501 |            2.6 s |                    2.6 s |                0.5 s |
 * |   10,000 |  5,001 |        5.2–5.8 s |                    5.2 s |                1.0 s |
 * |   20,000 | 10,001 |      10.3–11.5 s |                   10.3 s |                1.8 s |
 *
 * **Linear, at about a millisecond a turn, and nearly all of it the write.**
 * Parsing the file and building the tree together take about 0.1 s at 10,000
 * messages; the rest is `importSession`'s per-turn `appendTurnOnly` — a
 * segment append and an index row each, not batched — which is where a faster
 * import would have to look. Opening the session afterwards costs about a
 * fifth of a millisecond a turn, and it is the first request Play makes.
 *
 * ***The bound is on growth, not speed.*** Those figures were taken with the
 * file running mostly alone, which is not how CI runs it: `ci.yml`'s first
 * step is `pnpm test`, which runs the `fixture-pair` project at the same time
 * as the whole `packages` project, on ubuntu-latest and windows-latest both.
 * Measured again on the same container, the 10,000-message import took 7.5 s
 * run alone (`vitest run --project fixture-pair chat-size.test.ts`) and 15.3 s
 * run the way `pnpm test` runs it (`--project packages --project
 * fixture-pair`), nearly all of it the import. Windows writes small files
 * several times slower than this container, and the import does about fifteen
 * small-file operations a turn (the real-path check, two directory ensures, a
 * readdir, a re-read of the current segment, open, stat, read, append and
 * close, and an unbatched index row). An absolute bound of thirty seconds —
 * the first one set here — would have been about twice the loaded figure on
 * Linux and at or past it on Windows, and would fail on a runner's speed
 * rather than on the quadratic walk it exists to catch: F28's failure mode,
 * and short of F28's own rule of about ten times the loaded worst case.
 *
 * So the test imports a 1,000-message chat first and then the 10,000-message
 * one, in the same install, and bounds the *ratio*. Linear growth is about
 * 10, a quadratic walk about 100, and the ratio does not move with the
 * runner, because both imports run on the same one under the same load. The
 * ceiling is 25, which is two and a half times linear: room for a GC pause or
 * a load spike landing in the longer import, and still a long way under
 * quadratic. The small import runs first, so any warm-up it absorbs makes the
 * ratio smaller, never larger. An absolute bound stays, only as a hang
 * detector, at ten times the loaded 15.3 s; the test's own timeout is above
 * it, so a slow import fails *here*, with the milliseconds in the message,
 * rather than on vitest's timeout with nothing said.
 *
 * *No model is bound*, so the P13.11 warm has no summariser and makes no plan
 * and no call: what is timed is the import, not a summary chain being derived
 * behind it.
 */

const MESSAGES = 10_000;
const TURNS = MESSAGES / 2 + 1;
/** The small chat whose import time the large one's is divided by. */
const BASELINE_MESSAGES = 1_000;
/**
 * The most `took(10,000) / took(1,000)` may be: linear is about 10, quadratic
 * about 100. See the module docstring.
 */
const GROWTH_CEILING = 25;
/**
 * A hang detector, not a speed bound: about ten times the 15.3 s the import
 * took under `pnpm test`'s load. See the module docstring.
 */
const IMPORT_BUDGET_MS = 150_000;
const PATH = 'chats/Vera Solano/Vera Solano - a long year.jsonl';
const BASELINE_PATH = 'chats/Vera Solano/Vera Solano - a short month.jsonl';

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/**
 * A long chat as SillyTavern's `saveChat` writes one: the header, the card's
 * greeting (no generation record), then the player and the card in turn —
 * seven seconds apart, so the send times are strictly increasing and the ids
 * sort as the chat reads.
 */
function longChat(messages: number): Uint8Array {
  const at = (index: number): string =>
    new Date(Date.UTC(2025, 0, 1, 0, 0, index * 7)).toISOString();
  const lines: unknown[] = [
    {
      user_name: 'unused',
      character_name: 'unused',
      create_date: '2025-01-01@00h00m00s',
      chat_metadata: {
        integrity: `5a1e0000-0000-4000-8000-${String(messages).padStart(12, '0')}`,
      },
    },
  ];
  for (let index = 0; index < messages; index += 1) {
    const user = index % 2 === 1;
    lines.push({
      name: user ? 'The Inspector' : 'Vera Solano',
      is_user: user,
      is_system: false,
      send_date: at(index),
      mes: user ? `Line ${String(index)}: and the manifest?` : `Line ${String(index)}: the tide.`,
      extra: {},
      ...(user || index === 0 ? {} : { gen_started: at(index) }),
    });
  }
  return new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join('\n'));
}

/** The path from a root to `id`, root first. */
function pathTo(turns: readonly Turn[], id: string | null): Turn[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const path: Turn[] = [];
  for (let turn = byId.get(id ?? ''); turn !== undefined;) {
    path.unshift(turn);
    turn = turn.parentTurnId === null ? undefined : byId.get(turn.parentTurnId);
  }
  return path;
}

describe('a 10,000-message SillyTavern chat', () => {
  it(
    'imports through importChatFile in linear time, and reads back whole',
    { timeout: IMPORT_BUDGET_MS * 1.5 },
    async () => {
      const deps = {
        library: server.services.library,
        sessions: server.services.sessions,
        handle: 'ned',
      };
      const timed = async (path: string, bytes: Uint8Array) => {
        const started = performance.now();
        const report = await importChatFile(deps, path, bytes);
        return { report, took: performance.now() - started };
      };

      // The baseline first, so whatever warm-up it absorbs lowers the ratio.
      const baseline = await timed(BASELINE_PATH, longChat(BASELINE_MESSAGES));
      expect(baseline.report.disposition, JSON.stringify(baseline.report)).toBe('converted');
      const { report, took } = await timed(PATH, longChat(MESSAGES));

      expect(report.disposition, JSON.stringify(report)).toBe('converted');
      expect(report.notes).toContainEqual({
        key: 'import.chat.imported',
        params: { name: 'Vera Solano - a long year', turns: TURNS },
        level: 'info',
      });
      const measured =
        `importChatFile took ${String(Math.round(took))} ms for ${String(MESSAGES)} messages ` +
        `and ${String(Math.round(baseline.took))} ms for ${String(BASELINE_MESSAGES)}`;
      expect(took / baseline.took, measured).toBeLessThan(GROWTH_CEILING);
      expect(took, measured).toBeLessThan(IMPORT_BUDGET_MS);

      // --- It reads back: the document, then the routes Play opens it by. ---
      const id = report.objectId ?? '';
      const document = await exportSession(
        { sessions: server.services.sessions, build: null },
        'ned',
        id,
      );
      if (document === null) throw new Error('the session did not read back');
      const { turns } = document;
      expect(turns).toHaveLength(TURNS);
      expect(new Set(turns.map((turn) => turn.id)).size).toBe(TURNS);
      expect(turns.every((turn) => turn.foreign?.source === 'sillytavern')).toBe(true);

      // One unbranched line, greeting to head, in the chat's order.
      const head = (document.session as { headTurnId?: string | null }).headTurnId ?? null;
      const path = pathTo(turns, head);
      expect(path).toHaveLength(TURNS);
      expect(path[0]?.input).toBeUndefined();
      expect(path[0]?.output?.messages?.[0]?.text).toBe('Line 0: the tide.');
      expect(path.at(-1)?.input?.text).toBe(`Line ${String(MESSAGES - 1)}: and the manifest?`);
      expect(path.at(-1)?.output).toBeUndefined();

      const opened = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
      expect(opened.status).toBe(200);
      expect(opened.body.session.headTurnId).toBe(head);
      const listed = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
      expect(listed.status).toBe(200);
      expect((listed.body.turns as Turn[]).at(-1)?.id).toBe(head);
    },
  );
});
