// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LIBRARY_DIRECTORIES,
  type Candidate,
  type StepDefinition,
  type StepHost,
  type StepInput,
  type StepResult,
} from '@storyengine/sdk';

/**
 * ***Propose, then apply*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md)'s section of
 * that name, [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"Every mutation is a reviewable diff, not a silent write… the risk is not
 * editing somebody else's character; it is that an assistant quietly rewriting
 * your own work is the fastest way to stop trusting it."*
 *
 * ***A `post` step, so it reads an answer rather than writing one.*** The
 * assistant answers in prose — that is what a person reads — and a change worth
 * offering is *in* that prose as a suggestion. This step turns the suggestion
 * into something a diff can be rendered from. **The alternative was making the
 * answer itself structured**, which would have been the parallel implementation
 * §7.4 forbids in a different costume: the person would get JSON and the client
 * would have to render prose out of it.
 *
 * ***`warn`, never `abort`.*** By the time this runs the answer exists and is
 * the thing the person asked for. A turn discarded because a proposal could not
 * be extracted would be the footnote deciding whether the answer happened, which
 * is the same judgement `staging.ts` makes one mode over.
 *
 * ***It proposes onto a channel and touches no file.*** That is what keeps the
 * write on the person's side: `se.assistant.proposal` is session state, the
 * client renders it against the object as it stands, and applying it is an
 * ordinary library write the person makes with `GeneratedFieldProvenance`
 * attached ([10 §11.2]). Nothing in this package can reach a file, and the
 * package's single dependency is what makes that structural rather than
 * intended.
 */

export const SE_ASSISTANT_PROPOSE = 'se.assistant.propose';

export const PROPOSE_STEP: StepDefinition = {
  id: SE_ASSISTANT_PROPOSE,
  stage: 'post',
  /**
   * `output` for the answer it reads, and the context channel for **what object
   * a proposal could even be about**. Not `history`: a proposal is about the
   * thing just said, and a step that reread forty turns would be paying for
   * context to re-answer a question the last paragraph answers.
   */
  reads: ['output', 'se.assistant.context', 'se.assistant.proposal'],
  writes: ['se.assistant.proposal'],
  callKind: 'effects',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason and the one `staging.ts` gives: nothing in
   * this build binds any role but this one, so asking for `fast` would make
   * every assistant turn log a failed step.
   */
  role: 'prose',
};

const TASK = [
  'An assistant has just answered a question about the user’s own library.',
  'If the answer proposes a concrete change to one object — new wording for a',
  'field, a different value — say which object and which fields.',
  '',
  'Answer with null unless the answer really does propose a specific change to a',
  'specific object. Explaining, diagnosing and suggesting an approach are not',
  'changes. A change the user has to decide between two versions of is not one',
  'either: propose the one the answer recommends, or null.',
  '',
  /*
   * ***Honest about the paths*** (2026-09-30). This said `"summary"` and
   * `"sections.0.body"` were paths into the object; on an actor neither is —
   * the summary is a section under `profile` — and the model, which is never
   * shown the object, followed the examples. *Apply* then wrote a dead
   * top-level field and said it had worked. The client now shows and applies
   * only a path the object already holds as text, and this says so.
   */
  'Fields are dotted paths to text the object already holds, such as "name". A change',
  'to a path the object does not have is dropped, so name only fields you are sure of.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    change: {
      type: ['object', 'null'],
      properties: {
        kind: { type: 'string' },
        id: { type: 'string' },
        changes: { type: 'object', additionalProperties: { type: 'string' } },
        why: { type: 'string' },
      },
      required: ['kind', 'id', 'changes'],
      additionalProperties: false,
    },
  },
  required: ['change'],
  additionalProperties: false,
};

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_ASSISTANT_PROPOSE },
    reason: 'change proposal',
    role,
    text,
    required: true,
  };
}

interface Proposal {
  kind: string;
  id: string;
  changes: Record<string, string>;
  why?: string;
}

/**
 * Reads the answer, defensively.
 *
 * [P7.4] measured that `jsonSchema()` puts the document on the wire and **does
 * not validate** what comes back, so a well-formed reply against the wrong shape
 * is the ordinary case rather than the broken one. A proposal naming no object,
 * or changing nothing, is not a proposal.
 */
function proposalOf(value: unknown, about: { kind: string; id: string } | null): Proposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const change = (value as { change?: unknown }).change;
  if (typeof change !== 'object' || change === null) return null;
  const row = change as Partial<Proposal>;
  if (typeof row.changes !== 'object' || Object.keys(row.changes).length === 0) return null;

  const changes: Record<string, string> = {};
  for (const [path, next] of Object.entries(row.changes)) {
    if (typeof next === 'string') changes[path] = next;
  }
  if (Object.keys(changes).length === 0) return null;

  /**
   * ***The object is the one the person had open, not the one the model named.***
   * A proposal is applied by the client against what is on screen, and a model
   * free to nominate an id would be a model choosing which of your files gets a
   * diff put in front of you. The named pair is used only when the client
   * disclosed none — which is a session with no ambient context, where there is
   * nothing to overrule.
   */
  const kind = about?.kind ?? (typeof row.kind === 'string' ? row.kind : '');
  const id = about?.id ?? (typeof row.id === 'string' ? row.id : '');
  if (kind === '' || id === '' || !isLibraryKind(kind)) return null;

  return { kind, id, changes, ...(typeof row.why === 'string' ? { why: row.why } : {}) };
}

/**
 * ***A library object's kind, as its folder is named*** — the only kind a
 * proposal can be applied to, because applying is a library write.
 */
function isLibraryKind(kind: string): boolean {
  return (Object.values(LIBRARY_DIRECTORIES) as string[]).includes(kind);
}

export async function propose(input: StepInput, host: StepHost): Promise<StepResult> {
  const answer = input.output?.text ?? '';
  if (answer.trim() === '') return {};

  /**
   * ***What is on screen, when it is something a proposal can change***
   * (2026-09-30). Open over a session, the panel discloses that session — a
   * `session` kind and its id — and this took it as the target, so every
   * proposal made there was addressed to a session, which no library route
   * writes and the panel never shows: a mid-session proposal could not be
   * seen at all. Anything but a library object is no context, which is the
   * reading `proposalOf` already gives a session that disclosed nothing.
   */
  const seen = input.channels['se.assistant.context']?.value;
  const about =
    typeof seen === 'object' && seen !== null
      ? (() => {
          const row = seen as { kind?: unknown; id?: unknown };
          return typeof row.kind === 'string' &&
            typeof row.id === 'string' &&
            isLibraryKind(row.kind)
            ? { kind: row.kind, id: row.id }
            : null;
        })()
      : null;

  const result = await host.call({
    candidates: [
      block('se.assistant.propose.task', 'system', TASK),
      block('se.assistant.propose.answer', 'user', answer),
    ],
    schema: SCHEMA,
  });

  /**
   * ***An answer that proposes nothing withdraws the last offer*** (2026-09-30).
   * The panel shows the newest proposal on the path, so one made three
   * questions ago stood under every answer since — and came back after a
   * reload, which forgets *No thanks*. Each turn now states the current offer:
   * this one, or none.
   */
  const proposal = proposalOf(result.object, about);
  if (proposal === null) {
    const standing = input.channels['se.assistant.proposal']?.value;
    if (standing === undefined || standing === null) return {};
    return {
      effects: [
        {
          channelId: 'se.assistant.proposal',
          op: { type: 'set', path: '/' },
          after: null,
          proposedBy: { kind: 'model', callId: result.callId },
        },
      ],
    };
  }

  return {
    effects: [
      {
        channelId: 'se.assistant.proposal',
        op: { type: 'set', path: '/' },
        after: proposal,
        // Stamped `model`, because a model judged it — `staging.ts`'s
        // attribution and the reason `model-proposed` means anything.
        proposedBy: { kind: 'model', callId: result.callId },
      },
    ],
  };
}
