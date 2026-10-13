// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type {
  ImportedWorld,
  ImportPreviewWorld,
  ImportPreviewWorldObject,
} from '@storyengine/shared';

import { LIBRARY_KINDS } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Alert } from '../ui/Alert.js';
import { Badge } from '../ui/Badge.js';
import { control } from '../ui/classes.js';
import { Note } from '../ui/Text.js';
import { KIND_LABELS } from './labels.js';
import { sentence } from './note-labels.js';

/**
 * ***A World's file, before it lands*** —
 * [16 §5.1](../../../../docs/design/16-publish.md),
 * [10 §5](../../../../docs/design/10-ui-surfaces.md),
 * [P16.3f](../../../../docs/design/workplan/34-p16-world.md).
 *
 * **What 16 §5.1 asks the look to answer, in its order**: what is inside, *by
 * kind and name* — the manifest exists so that *do I want these in my
 * library* can be answered before anything is written — what already exists
 * here, and what dangles. Then what only a World's file has to say: its
 * sessions, each with how much of it there is, and what it asks of this
 * install that this install may not have.
 *
 * ***The decisions are two, and only when they are real*** ([10 §5]; the
 * plan's R5): keep it or not — the panel's own Import and Cancel — and, when
 * anything in it is here already, *replace or keep both*. Not per row: the
 * sender chose what travels, sessions included, and the person receiving
 * takes the file or does not. A session is never replaced and never copied
 * whichever is chosen, and the sentence beside the choice says so.
 *
 * ***What it never says***: whose an id is when it is not this account's. An
 * object another account on this install holds reads *new*, as one nobody
 * holds does (the server's anti-leak rule, `import/world/preview.ts`), so
 * there is nothing here to say it with.
 *
 * *A prediction*, as every preview here is: the look reads the manifest, and
 * the commit reads the file. Its report, after, is the truth.
 *
 * ***Off the entry*** — `ImportWorldLoad.tsx` loads this module with `lazy()`
 * (the setup wizard's and the changelog readers' shape, [21 §7.2]): the look
 * at a World's file is a panel nobody sees until they pick one, and the
 * stage's build measured the entry past 310 kB of its 312 with it on.
 */

const WORDS = labels('import.world-preview', {
  world: 'A world: “{name}”',
  noWorld: 'Objects sent on their own, without a world around them.',
  writtenBy: 'Written by StoryEngine {version} on {at}.',
  writtenByUnsaid: 'Written on {at}, by a build that did not say which.',
  legacy:
    'The older kind of world file, from before worlds travelled with their pictures: its objects and its list, no portraits or galleries.',
  beside: 'beside the world',
  here: 'already here',
  builtIn: 'built in',
  otherKinds: 'Other',
  sessions: 'Sessions',
  // One and many, each a whole phrase (2026-10-11, the P16.3f review: *1 turns*).
  sessionSize: '{turns}, {pictures}',
  turnsOne: '1 turn',
  turnsMany: '{count} turns',
  picturesOne: '1 picture',
  picturesMany: '{count} pictures',
  sessionHere: 'already here — anything played in it since is added to it',
  sessionsCome:
    'Each session arrives in Play as a session of your own. One already here is never replaced: only turns it does not have are added.',
  dangling: 'Left behind by its sender, and not in your library',
  resolved: 'Left behind by its sender, and found in your library',
  required: 'required',
  modeMissing:
    'It asks for the {mode} mode, version {minVersion} or later, which this install does not have. It comes in anyway; what needs that mode may not play.',
  extensions: 'It asks for extensions this build cannot check for: {list}.',
  capabilities: 'It asks for: {list}.',
  history: 'Each object’s version history comes with it.',
  noHistory: 'Each object comes as it is now, without its version history.',
  conflict: 'Some of this is already in your library.',
  conflictLabel: 'What to do with what is already here',
  replace: 'Replace it — the old state stays in its history',
  keepBoth: 'Keep both',
});

/** Whether the look found anything of the file here already — the one case with a second question. */
export function worldHasHere(world: ImportPreviewWorld): boolean {
  return (
    world.world?.here === true ||
    world.objects.some((one) => one.here === 'here') ||
    world.sessions.some((one) => one.here)
  );
}

export function ImportWorldPreview(props: {
  world: ImportPreviewWorld;
  onConflict: 'replace' | 'keep-both';
  busy: boolean;
  onPolicy: (policy: 'replace' | 'keep-both') => void;
}): JSX.Element {
  const { world } = props;
  const at = world.writtenBy.at.slice(0, 10);
  const dangling = world.leftBehind.filter((one) => !one.resolvesHere);
  const resolved = world.leftBehind.filter((one) => one.resolvesHere);
  const missingModes = world.requires.modes.filter((mode) => !mode.here);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <h5 className="font-medium text-ink">
          {world.world === null
            ? WORDS.noWorld
            : WORDS.world.replace('{name}', () => world.world?.name ?? '')}
        </h5>
        {world.world !== null && world.world.description !== '' ? (
          <p className="text-ink-subtle">{world.world.description}</p>
        ) : null}
        <Note>
          {world.writtenBy.version === null
            ? WORDS.writtenByUnsaid.replace('{at}', at)
            : WORDS.writtenBy.replace('{version}', world.writtenBy.version).replace('{at}', at)}
        </Note>
        {world.format === 'package-export' ? <Note>{WORDS.legacy}</Note> : null}
        <Note>{world.history ? WORDS.history : WORDS.noHistory}</Note>
      </div>

      {groups(world.objects).map(([title, rows]) => (
        <div key={title} className="flex flex-col gap-1">
          <h5 className="font-medium text-ink">{title}</h5>
          <ul className="flex flex-col">
            {rows.map((one) => (
              <li
                key={one.id}
                className="flex flex-wrap items-center gap-2 border-t border-line py-1"
              >
                <span className="text-ink">{one.name}</span>
                {one.here === 'here' ? <Badge>{WORDS.here}</Badge> : null}
                {one.here === 'built-in' ? <Badge tone="provenance">{WORDS.builtIn}</Badge> : null}
                {one.member ? null : (
                  <span className="text-xs text-ink-subtle">{WORDS.beside}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {world.sessions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="font-medium text-ink">{WORDS.sessions}</h5>
          <ul className="flex flex-col">
            {world.sessions.map((one) => (
              <li key={one.id} className="border-t border-line py-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{one.name}</span>
                  {one.here ? <Badge>{WORDS.here}</Badge> : null}
                </span>
                <span className="block text-xs text-ink-subtle">
                  {WORDS.sessionSize
                    .replace('{turns}', countPhrase(WORDS.turnsOne, WORDS.turnsMany, one.turns))
                    .replace(
                      '{pictures}',
                      countPhrase(
                        WORDS.picturesOne,
                        WORDS.picturesMany,
                        one.pictures + one.attachments,
                      ),
                    )}
                </span>
                {one.here ? (
                  <span className="block text-xs text-ink-subtle">{WORDS.sessionHere}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <Note>{WORDS.sessionsCome}</Note>
        </div>
      ) : null}

      {dangling.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="font-medium text-ink">{WORDS.dangling}</h5>
          <ul className="flex flex-col">
            {dangling.map((one, index) => (
              <li
                key={`${one.id ?? one.name}-${String(index)}`}
                className="flex flex-wrap items-center gap-2 border-t border-line py-1"
              >
                <span className="text-ink">{one.name}</span>
                {one.required ? <Badge tone="danger">{WORDS.required}</Badge> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {resolved.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="font-medium text-ink">{WORDS.resolved}</h5>
          <Note>{resolved.map((one) => one.name).join(', ')}</Note>
        </div>
      ) : null}

      {missingModes.map((mode) => (
        <Alert key={mode.id} tone="warning">
          {WORDS.modeMissing.replace('{mode}', mode.id).replace('{minVersion}', mode.minVersion)}
        </Alert>
      ))}
      {world.requires.extensions.length > 0 ? (
        <Note>
          {WORDS.extensions.replace(
            '{list}',
            world.requires.extensions.map((one) => `${one.id} ${one.minVersion}`).join(', '),
          )}
        </Note>
      ) : null}
      {world.requires.capabilities.length > 0 ? (
        <Note>{WORDS.capabilities.replace('{list}', world.requires.capabilities.join(', '))}</Note>
      ) : null}

      {world.omitted.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {world.omitted.map((note, index) => (
            <li key={index} className={note.level === 'warn' ? 'text-ink' : 'text-ink-subtle'}>
              {sentence(note)}
            </li>
          ))}
        </ul>
      ) : null}

      {worldHasHere(world) ? (
        <div className="flex flex-col gap-1">
          <Alert tone="warning">{WORDS.conflict}</Alert>
          <label htmlFor="import-world-on-conflict" className="text-sm font-medium text-ink">
            {WORDS.conflictLabel}
          </label>
          <select
            id="import-world-on-conflict"
            className={control}
            value={props.onConflict}
            disabled={props.busy}
            onChange={(event) => {
              props.onPolicy(event.target.value === 'keep-both' ? 'keep-both' : 'replace');
            }}
          >
            <option value="replace">{WORDS.replace}</option>
            <option value="keep-both">{WORDS.keepBoth}</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

/**
 * ***By kind***, in the library's own order — never one undifferentiated list
 * ([10 §5]: *the kinds are distinct on purpose and the browsing surface
 * should say so*), and a kind this build does not know last, as itself.
 */
function groups(
  objects: readonly ImportPreviewWorldObject[],
): (readonly [string, ImportPreviewWorldObject[]])[] {
  const out: (readonly [string, ImportPreviewWorldObject[]])[] = [];
  for (const kind of LIBRARY_KINDS) {
    const rows = objects.filter((one) => one.kind === kind);
    if (rows.length > 0) out.push([KIND_LABELS[kind], rows] as const);
  }
  const other = objects.filter((one) => one.kind === null);
  if (other.length > 0) out.push([WORDS.otherKinds, other] as const);
  return out;
}

/** A count as its phrase — the one and the many are whole phrases, for a catalogue to word. */
function countPhrase(one: string, many: string, count: number): string {
  return count === 1 ? one : many.replace('{count}', String(count));
}

const LANDED = labels('import.world-landed', {
  sentence: 'A world named “{name}” landed, naming {objects} and {sessions}.',
  objectsOne: '1 object',
  objectsMany: '{count} objects',
  sessionsOne: '1 session',
  sessionsMany: '{count} sessions',
  // ~~'{count} things its objects name …'~~ — *1 things*, and sessions' links
  // are counted too (2026-10-11, the P16.3f review).
  danglingOne: 'One thing this world names is not in your library.',
  danglingMany: '{count} things this world names are not in your library.',
  open: 'Open it',
});

/**
 * ***The line the review leads with after a World landed*** — [P16.3f]: *a
 * world named Rain City landed, naming 7 objects and 1 session — Open it.*
 * From the upload's `world`, which the server reads off the World's own row,
 * so this line and the review under it are one account of one import.
 *
 * *A plain link*, not the router's: the panel is the dock's, mounted on every
 * page and in tests with no router around it, and this is the one link it
 * draws — a page load on the click after an import is the price.
 */
export function WorldLanded(props: { world: ImportedWorld }): JSX.Element {
  const { world } = props;
  const said = LANDED.sentence
    .replace('{name}', () => world.name)
    .replace('{objects}', countPhrase(LANDED.objectsOne, LANDED.objectsMany, world.members))
    .replace('{sessions}', countPhrase(LANDED.sessionsOne, LANDED.sessionsMany, world.sessions));
  return (
    <div className="flex flex-col gap-1 text-sm" role="status">
      <p className="text-ink">
        {said}{' '}
        <a className="underline" href={`/library/worlds/${encodeURIComponent(world.id)}`}>
          {LANDED.open}
        </a>
      </p>
      {world.dangling > 0 ? (
        <Note>{countPhrase(LANDED.danglingOne, LANDED.danglingMany, world.dangling)}</Note>
      ) : null}
    </div>
  );
}
