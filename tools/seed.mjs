// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Puts a known library and a playable session into a running install — F35.
 *
 * **Every session started empty**, because the UI creates no library object of
 * any kind and a cast is API-only. (Half of that is retired: since P4.5 the
 * library page makes an actor, and since P4.4 an import fills a library. A cast
 * is still API-only, which is the half this script is really for, and the other
 * five kinds still arrive through here or through an import.) So the case a manual phase actually wanted to
 * test — a turn with a world and people in it — needed somebody to write curl by
 * hand first, every time, differently. *Empty* is not the case worth testing and
 * *different each run* is not a case at all.
 *
 * **Driven entirely through the HTTP API**, deliberately: it exercises the same
 * doors a person uses, so a seed that works proves the routes work, and a seed
 * that breaks is a finding rather than a broken script. Writing files directly
 * would be faster and would prove nothing.
 *
 * **Idempotent by slug.** Run it twice and you get the same install, not a second
 * copy — the library derives a slug from the name and suffixes duplicates, so a
 * blind re-run would quietly build `rain-city-2`. It reads first.
 *
 * Not a fixture corpus. [testing §5](../docs/design/workplan/10-testing.md) wants one of
 * those and it is a different thing: hand-authored, committed, deliberately
 * awkward. This is the smallest thing that makes an install playable.
 */

/**
 * **Objects come from the shared factories, not from hand-written JSON.**
 *
 * A portable object has a couple of dozen required fields with real defaults,
 * and a literal here would be a second copy of the schema — wrong the first time
 * somebody adds a key, and wrong in a way that shows up as a 400 rather than as
 * a type error. The factories are the same ones the app uses.
 *
 * Imported from the built output because this script is plain Node run against a
 * built server; `pnpm build` is a prerequisite either way.
 */
const { newActor, newLorebook, newLoreEntry, newTreatment } =
  await import('../packages/shared/dist/index.js');

const BASE = valueOf('--url') ?? 'http://127.0.0.1:8080';
const HANDLE = valueOf('--handle') ?? 'ned';
const PASSWORD = valueOf('--password') ?? 'correct horse battery';

/** Both cookies, and the CSRF token echoed on anything that changes something. */
const jar = new Map();

async function call(method, path, body) {
  const csrf = jar.get('se_csrf');
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jar.size === 0 ? {} : { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
      ...(csrf === undefined || method === 'GET' ? {} : { 'x-csrf-token': csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value) jar.set(name.trim(), value.trim());
  }

  const text = await response.text();
  const parsed = text.length === 0 ? null : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${String(response.status)} ${text.slice(0, 300)}`);
  }
  return parsed;
}

/** The object with this slug, or null — so a second run changes nothing. */
async function existing(kind, slug) {
  const listed = await call('GET', `/api/library?kind=${kind}`);
  return (listed.objects ?? []).find((object) => object.slug === slug) ?? null;
}

async function ensure(kind, slug, object) {
  const already = await existing(kind, slug);
  if (already !== null) {
    console.log(`  ${kind}/${slug} — already there`);
    return already.id;
  }
  const created = await call('POST', `/api/library/${kind}`, object);
  console.log(`  ${kind}/${slug} — created`);
  return created.id;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const state = await call('GET', '/api/auth/state');
  if (state.setupRequired) {
    await call('POST', '/api/auth/setup', {
      handle: HANDLE,
      password: PASSWORD,
      displayName: 'Ned',
    });
    console.log(`Created the first admin: ${HANDLE}`);
  } else {
    await call('POST', '/api/auth/login', { handle: HANDLE, password: PASSWORD });
    console.log(`Signed in as ${HANDLE}`);
  }

  console.log('Library:');
  const book = newLorebook('Rain City');
  const lorebook = await ensure('lorebooks', 'rain-city', {
    ...book,
    description: 'A harbour town where it has not stopped raining since the refinery closed.',
    entries: [
      {
        ...newLoreEntry('The refinery'),
        keys: ['refinery', 'the works'],
        content:
          'Shut for eleven years. The fence is down on the north side and nobody has fixed it.',
      },
      {
        ...newLoreEntry('The harbour'),
        keys: ['harbour', 'docks', 'water'],
        content: 'Two working boats and a lot of rope. The tide comes further up every year.',
      },
    ],
  });

  const actor = await ensure('actors', 'mara-vance', {
    ...newActor('Mara Vance'),
    description: 'Harbourmaster. Keeps the tide tables and most of the town’s secrets.',
    personality: 'Dry, unhurried, and harder to surprise than she looks.',
    greeting: '"You picked a wet day for it."',
    // A reference carries the name as well as the id — for display, and so a
    // link survives an id it cannot resolve ([10 §3]).
    lore: [{ id: lorebook, name: 'Rain City' }],
  });

  await ensure('treatments', 'a-wet-week', {
    ...newTreatment('A wet week'),
    blurb: 'A quiet mystery in a town that is running out of money.',
    lore: [{ ref: { id: lorebook, name: 'Rain City' }, required: true }],
    cast: [
      {
        ref: { id: actor, name: 'Mara Vance' },
        billing: 'npc',
        // *In this treatment* — the note is about the role here, not about the
        // actor, which is why it lives on the entry rather than on the card.
        note: 'The reason to go to the harbour, and the reason not to.',
      },
    ],
  });

  console.log('Session:');
  const sessions = await call('GET', '/api/sessions');
  const named = (sessions.sessions ?? []).find((session) => session.name === 'A wet week');
  if (named !== undefined) {
    console.log('  A wet week — already there');
  } else {
    const created = await call('POST', '/api/sessions', { name: 'A wet week' });
    await call('PUT', `/api/sessions/${created.session.id}/cast`, {
      persona: null,
      actors: [actor],
    });
    console.log('  A wet week — created, with Mara in the cast');
  }

  console.log('\nSeeded. A turn still needs a connection and a binding — see Settings.');
}

function usage() {
  console.log(
    [
      'Usage: node tools/seed.mjs [--url <base>] [--handle <h>] [--password <p>]',
      '',
      'Puts a known library and a playable session into a running install, through',
      'the HTTP API. Creates the first admin if there is not one yet, otherwise',
      'signs in. Idempotent: running it twice changes nothing.',
      '',
      'It does not create a connection or a binding — those carry a real key and',
      'belong to the person, not to a script.',
      '',
      'To start over: stop the server, `pnpm reset-data`, start it, run this.',
    ].join('\n'),
  );
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} needs a value.`);
    process.exit(1);
  }
  return value;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
