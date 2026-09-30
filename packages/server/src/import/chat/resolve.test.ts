// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { create } from '../../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { libraryLookup } from '../chat-sessions.js';
import { sillyTavernFixture } from '../fixtures/test-sillytavern.js';
import { MemoryFileSource } from '../memory-source.js';
import { parseSillyTavernChat, SPEAKER_BY_NAME } from '../sillytavern/chat.js';
import { sweep } from '../sweep.js';
import { resolveChat, type ChatLibrary, type ChatLibraryKind } from './resolve.js';
import type { ChatFamily, ChatMessage, ResolvedRef } from './types.js';

/**
 * ***Resolution, as [P14 §2.5]'s table*** —
 * [P14.8](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * Most of this runs against a library that is two maps, because what is under
 * test is the table — which file a key is tried as, in what order, and what a
 * second actor with the same name does — and a server would make each case a
 * sweep. The last `describe` is the one that is not: the real lookup over the
 * real index, after a real sweep, since a table that is right against a fake
 * and wrong against the stamps the sweep actually writes would be right about
 * nothing.
 */

/** A library that is two maps: import stamps, and names. */
function library(
  imported: Record<string, ResolvedRef> = {},
  named: Record<string, ResolvedRef[]> = {},
): ChatLibrary & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    imported: (kind: ChatLibraryKind, filename: string) => {
      asked.push(`${kind}:${filename}`);
      return imported[`${kind}:${filename}`] ?? null;
    },
    named: (kind: ChatLibraryKind, name: string) => named[`${kind}:${name}`] ?? [],
  };
}

function family(messages: ChatMessage[], source: ChatFamily['source'] = 'sillytavern'): ChatFamily {
  return {
    source,
    key: 'chats/Vera Solano/one.jsonl',
    name: 'one',
    chats: [{ id: 'chats/Vera Solano/one.jsonl', name: 'one', messages, createdAt: null }],
  };
}

const line = (key: string, name = 'Vera Solano'): ChatMessage => ({
  role: 'character',
  text: 'Hm.',
  speaker: { key, name },
  at: null,
  foreignId: `x#${key}`,
});

const player = (key: string, name: string): ChatMessage => ({
  role: 'user',
  text: 'Well?',
  persona: { key, name },
  at: null,
  foreignId: `y#${key}`,
});

const VERA = { id: 'actor-vera', name: 'Vera Solano' };

describe('a speaker', () => {
  it('is found as the sweep stamps a card: under characters/ first', () => {
    const lib = library({ 'actor:characters/Vera Solano.png': VERA });

    const { resolution } = resolveChat(family([line('Vera Solano.png')]), {}, lib);

    expect(resolution.speakers.get('Vera Solano.png')).toEqual(VERA);
    expect(lib.asked[0]).toBe('actor:characters/Vera Solano.png');
  });

  it('is found as a single uploaded card is stamped: the bare file name', () => {
    const lib = library({ 'actor:Vera Solano.png': VERA });

    const { resolution } = resolveChat(family([line('Vera Solano.png')]), {}, lib);

    expect(resolution.speakers.get('Vera Solano.png')).toEqual(VERA);
  });

  it('prefers the import stamp to a name, which survives a rename in the library', () => {
    // The actor was renamed here after its import. The chat still names the
    // file it came from, and the file is what meets.
    const renamed = { id: 'actor-vera', name: 'Inspector Solano' };
    const lib = library(
      { 'actor:characters/Vera Solano.png': renamed },
      { 'actor:Vera Solano': [{ id: 'someone-else', name: 'Vera Solano' }] },
    );

    const { resolution } = resolveChat(family([line('Vera Solano.png')]), {}, lib);

    expect(resolution.speakers.get('Vera Solano.png')).toEqual(renamed);
  });

  it('falls back to an exact, unique name when no file meets', () => {
    const lib = library({}, { 'actor:Vera Solano': [VERA] });

    const { resolution, notes } = resolveChat(family([line('Vera Solano.png')]), {}, lib);

    expect(resolution.speakers.get('Vera Solano.png')).toEqual(VERA);
    expect(notes).toEqual([]);
  });

  it('is nobody when two actors share the name, and says so once', () => {
    // [P14 §2.5]'s *unique*: choosing one of two would be the import deciding
    // whose conversation it was.
    const lib = library(
      {},
      {
        'actor:Vera Solano': [VERA, { id: 'actor-vera-2', name: 'Vera Solano' }],
      },
    );

    const resolved = resolveChat(
      family([line('Vera Solano.png'), line(`${SPEAKER_BY_NAME}Vera Solano`)]),
      {},
      lib,
    );

    expect(resolved.resolution.speakers.get('Vera Solano.png')).toBeNull();
    expect(resolved.resolution.speakers.get(`${SPEAKER_BY_NAME}Vera Solano`)).toBeNull();
    expect(resolved.notes).toEqual([
      {
        key: 'import.chat.nameAmbiguous',
        params: { name: 'Vera Solano', count: 2 },
        level: 'warn',
      },
    ]);
    expect([...resolved.ambiguous]).toEqual(['Vera Solano']);
  });

  it('goes straight to the name when the line gave nothing else', () => {
    const lib = library({}, { 'actor:Maris Okonkwo': [{ id: 'actor-maris', name: 'Maris' }] });

    const { resolution } = resolveChat(
      family([line(`${SPEAKER_BY_NAME}Maris Okonkwo`, 'Maris Okonkwo')]),
      {},
      lib,
    );

    expect(resolution.speakers.get(`${SPEAKER_BY_NAME}Maris Okonkwo`)?.id).toBe('actor-maris');
    // No file was tried for a key that names no file.
    expect(lib.asked).toEqual([]);
  });

  it('is left unresolved, never invented, when the library has nobody', () => {
    const { resolution, notes } = resolveChat(family([line('Ghost.png', 'Ghost')]), {}, library());

    expect(resolution.speakers.get('Ghost.png')).toBeNull();
    // The builder says *not in this library* for these; the resolver adds
    // nothing, so the person reads it once.
    expect(notes).toEqual([]);
  });

  it('reads a Marinara character id as the row Marinara’s reader stamped', () => {
    const lib = library({ 'actor:storage/tables/characters.json#char_7': VERA });

    const { resolution } = resolveChat(family([line('char_7')], 'marinara'), {}, lib);

    expect(resolution.speakers.get('char_7')).toEqual(VERA);
  });
});

describe('the persona', () => {
  const INSPECTOR = { id: 'actor-inspector', name: 'The Inspector' };

  it('is the one the player’s lines were locked to', () => {
    const lib = library({ 'actor:User Avatars/inspector.png': INSPECTOR });

    const { resolution } = resolveChat(
      family([player('User Avatars/inspector.png', 'The Inspector')]),
      {},
      lib,
    );

    expect(resolution.persona).toEqual(INSPECTOR);
  });

  it('takes the lines over the chat’s lock, and the most-used line over the rest', () => {
    const lib = library({
      'actor:User Avatars/inspector.png': INSPECTOR,
      'actor:User Avatars/clerk.png': { id: 'actor-clerk', name: 'The Clerk' },
    });

    const { resolution } = resolveChat(
      family([
        player('User Avatars/clerk.png', 'The Clerk'),
        player('User Avatars/inspector.png', 'The Inspector'),
        player('User Avatars/inspector.png', 'The Inspector'),
      ]),
      { persona: 'User Avatars/clerk.png' },
      lib,
    );

    expect(resolution.persona).toEqual(INSPECTOR);
  });

  it('is the chat’s lock when no line carries one', () => {
    const lib = library({ 'actor:User Avatars/inspector.png': INSPECTOR });

    const { resolution } = resolveChat(
      family([line('Vera Solano.png')]),
      { persona: 'User Avatars/inspector.png' },
      lib,
    );

    expect(resolution.persona).toEqual(INSPECTOR);
  });

  it('is none, with a note, when the library does not have it', () => {
    const { resolution, notes } = resolveChat(
      family([player('User Avatars/ned.png', 'Ned')]),
      {},
      library(),
    );

    expect(resolution.persona).toBeNull();
    expect(notes).toEqual([
      { key: 'import.chat.personaUnresolved', params: { persona: 'Ned' }, level: 'warn' },
    ]);
  });

  it('is not the chat’s own character, found by a name the player borrowed', () => {
    // The player called their persona after the character. A unique name match
    // on an actor already speaking in the chat is that, not the player.
    const lib = library({ 'actor:characters/Vera.png': VERA }, { 'actor:Vera Solano': [VERA] });

    const { resolution, notes } = resolveChat(
      family([line('Vera.png'), player('User Avatars/v.png', 'Vera Solano')]),
      {},
      lib,
    );

    expect(resolution.speakers.get('Vera.png')).toEqual(VERA);
    expect(resolution.persona).toBeNull();
    expect(notes).toEqual([
      { key: 'import.chat.personaUnresolved', params: { persona: 'Vera Solano' }, level: 'warn' },
    ]);
  });

  it('says nothing when the chat never said who the player was', () => {
    const { resolution, notes } = resolveChat(family([line('Vera Solano.png')]), {}, library());

    expect(resolution.persona).toBeNull();
    expect(notes).toEqual([]);
  });
});

describe('the chat’s lorebook', () => {
  const BOOK = { id: 'book-rain', name: 'Rain City' };

  it('is the world file the sweep stamped, then the bare file, then the name', () => {
    for (const lib of [
      library({ 'lorebook:worlds/Rain City.json': BOOK }),
      library({ 'lorebook:Rain City.json': BOOK }),
      library({}, { 'lorebook:Rain City': [BOOK] }),
    ]) {
      const { resolution } = resolveChat(family([]), { lore: ['Rain City'] }, lib);
      expect(resolution.lore).toEqual(['book-rain']);
    }
  });

  it('is not linked, with a note, when it is not here', () => {
    const { resolution, notes } = resolveChat(family([]), { lore: ['Rain City'] }, library());

    expect(resolution.lore).toEqual([]);
    expect(notes).toEqual([
      { key: 'import.chat.loreUnresolved', params: { book: 'Rain City' }, level: 'warn' },
    ]);
  });
});

describe('against a real library, after a real sweep', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.dispose();
    server = undefined;
  });

  it('finds the swept card, persona and world through the stamps the sweep wrote', async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    const tree = sillyTavernFixture();
    // The library half only: this is about what the resolver finds, not what
    // the session pass does with it.
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      files: new MemoryFileSource(tree),
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const idOf = (source: string): string | undefined =>
      outcome.report.items.find((item) => item.source === source)?.objectId;

    const path = 'chats/Vera Solano/2026-01-01.jsonl';
    const parsed = parseSillyTavernChat(String(tree[path]), path);
    if (!parsed.ok) throw new Error(parsed.refusal);
    const { chat, meta } = parsed.value;

    const { resolution, notes } = resolveChat(
      { source: 'sillytavern', key: path, name: chat.name, chats: [chat] },
      { persona: meta.persona ?? '', lore: meta.worldInfo === undefined ? [] : [meta.worldInfo] },
      libraryLookup(server.services.library, 'ned'),
    );

    expect(resolution.speakers.get('Vera Solano.png')).toEqual({
      id: idOf('characters/Vera Solano.png'),
      name: 'Vera Solano',
    });
    expect(resolution.persona).toEqual({
      id: idOf('User Avatars/inspector.png'),
      name: 'The Inspector',
    });
    expect(resolution.lore).toEqual([idOf('worlds/Rain City.json')]);
    expect(notes).toEqual([]);
  });

  it('counts two actors with one name as two, and matches neither', async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    await create(server.services.library, 'ned', newActor('Ilse Brandt'));
    await create(server.services.library, 'ned', newActor('Ilse Brandt'));
    await create(server.services.library, 'ned', newActor('Maris Okonkwo'));

    const lookup = libraryLookup(server.services.library, 'ned');

    expect(lookup.named('actor', 'Ilse Brandt')).toHaveLength(2);
    // Exact: a different case is a different name.
    expect(lookup.named('actor', 'maris okonkwo')).toEqual([]);
    const { resolution } = resolveChat(
      family([line(`${SPEAKER_BY_NAME}Ilse Brandt`, 'Ilse Brandt'), line('x', 'Maris Okonkwo')]),
      {},
      lookup,
    );
    expect(resolution.speakers.get(`${SPEAKER_BY_NAME}Ilse Brandt`)).toBeNull();
    expect(resolution.speakers.get('x')?.name).toBe('Maris Okonkwo');
  });
});
