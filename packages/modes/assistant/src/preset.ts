// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/sdk';

/**
 * The assistant's default prompt pack —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***Six blocks, and five of them are the same slots a story mode uses.*** That
 * is the claim §7.4 makes — *"it is a session, in a mode, with an actor card.
 * That is the whole design"* — arriving as an observation about a file: the
 * persona, the card's own summary, the lore, the history and the input are the
 * engine's vocabulary, and an assistant assembling a prompt wants the same ones
 * a narrator does. **Only the instruction differs, and one slot is new.**
 *
 * ***The new one is the disclosure.*** `se.assistant.context` is a channel slot,
 * which means the ambient context is *"a block the client contributes"* and is
 * *"visible in the turn record like any other block"* — §7.4's two sentences,
 * satisfied by a slot rather than by a feature. A pack that removed this block
 * would produce an assistant that cannot see your screen, which is a legitimate
 * preference; a pack that kept the context and hid the block is not expressible,
 * which is the point.
 *
 * ***Docs retrieval is the lore slot and nothing else.*** §7.4: *"Docs retrieval
 * needs no new machinery. Ship the documentation as a built-in lorebook and
 * attach it to the assistant. Keyword activation plus the budgeter already do
 * the work."* So the slot is here, ready, and **the corpus is not** — which is
 * recorded at [P11.3] rather than faked with an empty book.
 *
 * ***A lower temperature than either story mode's 0.85.*** The two narrators are
 * writing fiction and want the variance; this is answering a question about a
 * file on disk, where the same question twice should not get two different
 * answers about what a field does. *That is a mode having an opinion about
 * generation parameters, which is what the field is for.*
 */

/** Fixed, so a golden snapshot over this object is reproducible. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const ASSISTANT_PRESET: Preset = {
  schema: 'storyengine.preset/0',
  id: '0199c000-0000-7000-8000-00000000a551',
  name: 'Assistant',
  blurb: '',
  modes: ['storyengine.assistant'],
  blocks: [
    {
      id: 'se.instruction',
      label: 'instruction',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 90,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      /**
       * ***What it may do, not how it talks*** — §7.4's *capabilities belong to
       * the mode, personality to the card*. Nothing here describes a voice,
       * because the card carries that and swapping the card has to change it.
       *
       * **The refusal in the last sentence is the one that matters.** §7.4
       * scopes tools to the domain because *"on a multi-user LAN server, an
       * in-app assistant with shell access is a privilege-escalation path
       * wearing a friendly hat"*. This build gives it no tools at all, so the
       * sentence is not a guard — it is an honest statement of what it can do,
       * which is what stops it promising to go and look.
       */
      template: [
        'You are the assistant built into StoryEngine, a self-hosted app for telling',
        'stories with language models. You help the person work out what they are doing:',
        'what a setting does, why a lorebook entry never fires, how to word a preset',
        'block, what to put in a character.',
        '',
        'You can see what they have open, if they have anything open, and whatever',
        'documentation was retrieved for this question. You cannot read their files,',
        'run anything, or change anything — if a change is wanted, describe it and',
        'they will apply it. Say when you do not know rather than guessing at a',
        'setting that may not exist.',
      ].join('\n'),
    },
    {
      id: 'se.persona',
      label: 'persona',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'persona' },
    },
    {
      id: 'se.actor.summary',
      label: 'actor.summary',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'actor', sectionId: 'se.summary' },
    },
    {
      id: 'se.assistant.context',
      label: 'what you are looking at',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 65,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'channel', channelId: 'se.assistant.context' },
    },
    {
      id: 'se.lore',
      label: 'lore',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 25,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'lore', phase: 'before' },
    },
    {
      id: 'se.history',
      label: 'history',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 20,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'history' },
    },
    {
      id: 'se.guidance',
      label: 'guidance',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 95,
      appliesTo: [],
      /**
       * ***Advisory, which is what the guidance box is*** — [06 §5.2]. *"Be
       * brief"* as an out-of-band nudge is one of the seven rows §7.4 says the
       * assistant gets for free, and it is only free if the slot is here.
       */
      advisory: true,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'guidance' },
    },
    {
      id: 'se.input',
      label: 'input',
      role: 'user',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 100,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'input' },
    },
  ],
  budget: {
    contextShare: 0.75,
    maxContextTokens: null,
    reserveOutputTokens: 1024,
    sources: [],
  },
  params: {
    temperature: 0.4,
    maxTokens: 900,
  },
  modelHint: null,
  variables: [],
  tags: [],
  provenance: {
    source: 'manual',
    creator: null,
    version: null,
    license: null,
    originalFilename: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  generated: null,
  compat: null,
  metadata: {},
};
