// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Aventuras' three single-file vault exports, synthesised
 * ([P4 §1.2](../../../../../docs/design/workplan/16-p4-implementation.md),
 * [§1.5](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Content, not files, and code rather than bytes**, on `test-sillytavern.ts`'s
 * two reasons: somebody else's authored content is generally not
 * redistributable, and a binary in a diff is a binary nobody reviews. These are
 * plain JSON, so neither hazard applies to the bytes — but the third reason
 * does, and it is the one that matters here: **a fixture built in code says
 * where every field came from**, and these were read off
 * `src/lib/types/index.ts` at `master` rather than remembered.
 *
 * The shapes are exactly what `lorebookImportExport/export/vault.ts` writes:
 * `JSON.stringify(entity, null, 2)` and nothing else — no envelope, no `spec`,
 * no version. Every oddity below is one the real export has, and each says so.
 */

/**
 * `VaultScenario`, as `exportVaultScenario` writes one.
 *
 * Built by Aventuras from a character card through an LLM cleaning pass, which
 * is why `settingSeed` is third-person setting prose rather than a card's
 * first-person blurb, and why `description` is its first ~200 characters.
 */
export function aventurasScenario(): Record<string, unknown> {
  return {
    id: '4b1c0f2e-2f9a-4a7e-9a1e-2c8f3d4e5a6b',
    name: 'Ash Harbour',
    description:
      'A working port under permanent rain, where the manifests and the cargo have stopped agreeing.',
    settingSeed:
      'Ash Harbour has been wet for eleven days. The cranes run on a skeleton crew, the ' +
      'inspectors are three weeks behind, and every manifest that clears the gate has ' +
      'been signed by somebody who did not look. The money in this town moves at night.',
    npcs: [
      {
        name: 'Ines Vaur',
        role: 'Dock inspector',
        description: 'Notices what the manifests leave out, and writes it down anyway.',
        relationship: 'Wary of you, and not yet against you',
        traits: ['patient', 'unbribable'],
      },
      {
        name: 'The Dockmaster',
        role: 'Runs the gate',
        description: 'Has signed everything for nine years and read none of it.',
        relationship: 'Owes you a favour he has forgotten',
        traits: ['affable', 'incurious'],
      },
    ],
    primaryCharacterName: 'Ines Vaur',
    firstMessage: 'The rain finds your collar before the gatehouse does.',
    alternateGreetings: ['The gate is shut, and the light in the office is on.'],
    tags: ['noir', 'imported'],
    favorite: false,
    source: 'import',
    originalFilename: 'ash-harbour.png',
    /**
     * **`linkedLorebookId` is the interesting field and it is here on purpose.**
     *
     * When a card carries an embedded `character_book`, Aventuras splits it into
     * a *separate* vault lorebook and cross-references it by id
     * (`scenarioVault.svelte.ts`). The id names a row in their database and is
     * meaningless here — but its presence means the person is missing half their
     * world and does not know it, which is the one thing this converter must not
     * let pass silently.
     */
    metadata: {
      cardVersion: 'chara_card_v2',
      npcCount: 2,
      alternateGreetingsCount: 1,
      hasFirstMessage: true,
      linkedLorebookId: 'd7e8f9a0-1b2c-3d4e-5f60-718293a4b5c6',
    },
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_400_000_000,
  };
}

/** `VaultCharacter`, as `exportVaultCharacter` writes one. */
export function aventurasCharacter(): Record<string, unknown> {
  return {
    id: '9f8e7d6c-5b4a-3928-1706-f5e4d3c2b1a0',
    name: 'Ines Vaur',
    description: 'A dock inspector who notices what the manifests leave out.',
    traits: ['patient', 'unbribable', 'tired'],
    // The same seven keys ours has — ours was taken from theirs — so this
    // should arrive unchanged rather than mapped.
    visualDescriptors: {
      face: 'weathered, mid-forties, permanently unimpressed',
      hair: 'grey, cropped, wet',
      eyes: 'pale grey',
      build: 'short and square',
      clothing: 'oilskin over a uniform three years out of date',
      accessories: 'a clipboard in a plastic sleeve',
      distinguishing: 'a burn scar across the left hand',
    },
    // A data URL in the real export. Truncated here because the bytes are not
    // what is under test — that it is *reported and not carried* is.
    portrait: 'data:image/png;base64,iVBORw0KGgo=',
    tags: ['npc', 'harbour'],
    favorite: true,
    source: 'story',
    originalStoryId: '11112222-3333-4444-5555-666677778888',
    metadata: { extractedFrom: 'Ash Harbour' },
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_100_000_000,
  };
}

/**
 * The `aventura` lorebook format — a **bare array**, as `exportToAventura`
 * writes one (`JSON.stringify(entries, null, 2)`).
 *
 * This is the shape [P4 §1.5] did not see: that stage found Aventuras' *other*
 * lorebook export, the SillyTavern one, and concluded its lore needed no
 * Aventuras code. `export/formats.ts` offers three formats and this is the
 * default-looking one.
 */
export function aventurasLorebook(): Record<string, unknown>[] {
  return [
    {
      id: 'a1',
      storyId: 's1',
      name: 'Ash Harbour',
      type: 'location',
      description: 'A working port under permanent rain.',
      hiddenInfo: 'The harbour authority has been insolvent since spring.',
      aliases: ['the harbour', 'the port'],
      injection: { mode: 'always', keywords: [], priority: 900 },
      // The dynamic half of their unified `Entry` — channel-shaped, and
      // deliberately present so the converter has something to *record* rather
      // than promote. [04 §5]: an exported lorebook must not carry a playthrough.
      state: { type: 'location', isCurrentLocation: true, visitCount: 3, changes: [] },
      createdBy: 'import',
    },
    {
      id: 'a2',
      storyId: 's1',
      name: 'Ines Vaur',
      type: 'character',
      description: 'The inspector who keeps writing things down.',
      hiddenInfo: null,
      aliases: ['Inspector Vaur'],
      injection: { mode: 'keyword', keywords: ['Ines', 'Vaur', 'inspector'], priority: 500 },
      createdBy: 'user',
    },
    {
      id: 'a3',
      storyId: 's1',
      name: 'The Night Shift',
      // A type outside our suggested vocabulary is fine — `tag` is an open
      // string ([03 §3.4]) — and it has to survive the trip back out.
      type: 'concept',
      description: 'Nothing that moves after ten has a name on it.',
      hiddenInfo: null,
      aliases: [],
      injection: { mode: 'never', keywords: ['night shift'], priority: 100 },
      createdBy: 'ai',
    },
  ];
}

/** The three, as an upload tree a `MemoryFileSource` can read. */
export function aventurasFiles(): Record<string, string> {
  return {
    'Ash Harbour.json': JSON.stringify(aventurasScenario(), null, 2),
    'Ines Vaur.json': JSON.stringify(aventurasCharacter(), null, 2),
    'Harbour lore.json': JSON.stringify(aventurasLorebook(), null, 2),
  };
}
