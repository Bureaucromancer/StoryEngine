// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { Closure, FileSet, NodeKey, SessionNode } from '@storyengine/shared';

import { formatTimestamp, megabytes } from '../../format.js';
import { Note, SectionTitle } from '../../ui/Text.js';
import { MissingUnder } from './ClosureList.js';
import { isOn, sessionBrings } from './model.js';
import { Tick } from './Tick.js';
import { countPhrase, WORDS } from './words.js';

/**
 * ***A checkbox per session, each off*** — [16 §5](../../../../../docs/design/16-publish.md):
 * *"sending somebody your transcripts is a thing to choose rather than a
 * thing to discover you did."* [P16.3g](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * **What a session row says is what would leave with it**, so the tick is made
 * knowing it:
 *
 * - how much — turns, pictures, size, and when it was last played;
 * - what it would bring that nothing else in the file does (R1's one cascade:
 *   its cast and books travel only with it);
 * - that its connection settings stay here ([16 §2]: *a connection is never on
 *   it*);
 * - ***the two facts the fact check named, said rather than scrubbed***
 *   (2026-10-10, the lead's decisions recorded in [P16.3]): **its turns record
 *   which model answered** — a connection's *id*, never the connection — and
 *   **its recorded prompts may quote memories drawn from other sessions**,
 *   because a turn keeps the prompt it sent, and that prompt is what the
 *   session sent. Scrubbing them would make the transcript something it was
 *   not; saying them makes the tick an informed one. *Corrected 2026-10-11,
 *   the [P16 audit] (privacy finding 1):* a turn also kept the words of the
 *   blocks its budget **dropped**, which it never sent; those no longer
 *   travel (the writer keeps each one's row), and the sentence says so.
 *
 * *Only for a World start*: a session reaches Publish by being a member of a
 * World ([16 §2]), so no other start has any.
 */
export function SessionChoices(props: {
  closure: Closure;
  set: FileSet;
  ticked: Readonly<Record<NodeKey, boolean>>;
  locale: string | undefined;
  onTick: (key: NodeKey, on: boolean) => void;
}): JSX.Element | null {
  const sessions = props.closure.nodes.filter(
    (node): node is SessionNode => node.state === 'session',
  );
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby="publish-sessions" className="mb-8">
      <SectionTitle as="h2" id="publish-sessions" className="mb-1">
        {WORDS.sessionsTitle}
      </SectionTitle>
      <Note className="mb-3">{WORDS.sessionsLead}</Note>
      <ul className="flex flex-col gap-3">
        {sessions.map((session) => (
          <SessionRow key={session.key} {...props} session={session} />
        ))}
      </ul>
    </section>
  );
}

function SessionRow(props: {
  closure: Closure;
  set: FileSet;
  ticked: Readonly<Record<NodeKey, boolean>>;
  locale: string | undefined;
  session: SessionNode;
  onTick: (key: NodeKey, on: boolean) => void;
}): JSX.Element {
  const { session } = props;
  const brings = sessionBrings(props.closure, session, props.set, props.ticked);
  const facts = session.facts;
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-line pb-3">
      <Tick
        label={session.name}
        checked={isOn(session, props.ticked)}
        onChange={(on) => {
          props.onTick(session.key, on);
        }}
        {...(facts === undefined
          ? {}
          : {
              hint: WORDS.sessionFacts
                .replace('{turns}', countPhrase(WORDS.turnsOne, WORDS.turnsMany, facts.turns))
                .replace(
                  '{pictures}',
                  countPhrase(WORDS.sessionPicturesOne, WORDS.sessionPicturesMany, facts.pictures),
                )
                .replace('{size}', megabytes(facts.bytes))
                .replace('{date}', formatTimestamp(session.updatedAt, props.locale)),
            })}
      />
      <ul className="ms-6 flex flex-col gap-0.5 text-sm text-ink-subtle">
        {session.archived ? <li>{WORDS.archived}</li> : null}
        {brings === 0 ? null : <li>{countPhrase(WORDS.bringsOne, WORDS.bringsMany, brings)}</li>}
        <li>{WORDS.models}</li>
        <li>{WORDS.memories}</li>
        {session.leavesBehind.length === 0 ? null : <li>{WORDS.bindings}</li>}
        {facts === undefined || facts.missingPixels === 0 ? null : (
          <li>
            {countPhrase(WORDS.missingPixelsOne, WORDS.missingPixelsMany, facts.missingPixels)}
          </li>
        )}
      </ul>
      <div className="ms-6">
        <MissingUnder
          closure={props.closure}
          nodeKey={session.key}
          carried={isOn(session, props.ticked)}
        />
      </div>
    </li>
  );
}
