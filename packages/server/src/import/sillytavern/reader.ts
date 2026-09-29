// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportDisposition, ImportItemReport, ImportNote } from '@storyengine/shared';

import { codecFor } from '../../storage/card/index.js';
import { looksLikeCard, readUpload } from '../upload.js';
import type {
  FileSource,
  ImportCandidate,
  SourceItem,
  SourceReader,
  SourceSurvey,
} from '../source.js';
import { SILLYTAVERN_DISPOSITIONS } from '../registries/sillytavern.js';
import { SILLYTAVERN_CHAT_FORMAT, SILLYTAVERN_GROUP_FORMAT } from './chat.js';

/**
 * The SillyTavern tree, read as candidates
 * ([P4 §1.3](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The degenerate case, and that is the point.** One file yields zero or one
 * candidate here, which is what a directory of files means — and it is the
 * standing check on the seam: if this walker ever grows complexity in order to
 * accommodate Marinara's relational store, the abstraction is in the wrong
 * place.
 *
 * Every path it sees is accounted for. A file under a directory the registry has
 * a disposition for gets that disposition; anything else is `unrecognised` and
 * counted, never passed over.
 */

/** ST's persona metadata lives in the settings file, not beside the images. */
interface Personas {
  names: Record<string, string>;
  descriptions: Record<string, { description?: unknown }>;
}

export class SillyTavernReader implements SourceReader {
  readonly kind: 'sillytavern' | 'loose-files';

  readonly #files: FileSource;

  /**
   * **The walker serves two roots, and it now knows which one it is on**
   * ([P4 §7.8](../../../../../docs/design/workplan/16-p4-implementation.md)).
   *
   * `loose-files` is what `classifyRoot` returns when no probe matches, and
   * `sweep.ts` has always handed it here on the reasoning that *a folder of
   * cards somebody assembled by hand is the ST tree with most of it missing*.
   * The intent was right and the code did something else: routing is by
   * top-level directory, so `Vera.png` sitting at the root took the `default:`
   * arm and came back `unrecognised` — with no note at all, so the review could
   * not even say why. A loose folder converted nothing, and the test named
   * *"sweeps a folder of loose cards rather than refusing it"* asserted only the
   * classification, never that anything swept.
   *
   * The kind is a constructor argument rather than a second class because the
   * two roots differ in exactly one arm. A `LooseFilesReader` would have had to
   * restate the disposition table to keep a loose folder's `backgrounds/`
   * behaving like a real one's, and a table restated in two places is the
   * failure [§1.8] exists to prevent.
   */
  constructor(files: FileSource, kind: 'sillytavern' | 'loose-files' = 'sillytavern') {
    this.#files = files;
    this.kind = kind;
  }

  survey(): Promise<SourceSurvey> {
    // Nothing to refuse: a SillyTavern tree has no writer lease, no storage
    // format and no shard layout. The pre-flight exists for stores that can be
    // caught mid-write, and a folder of files cannot be.
    return Promise.resolve({ ok: true, kind: this.kind, notes: [] as ImportNote[] });
  }

  async *items(): AsyncIterable<SourceItem> {
    const personas = await this.#readPersonas();

    for await (const path of this.#files.list()) {
      const item = await this.#read(path, personas);
      if (item !== null) yield item;
    }
  }

  /**
   * `settings.json`, read once and up front.
   *
   * **The tree's one irregular case** ([P4 §1.8]): a persona is an image in
   * `User Avatars/` whose name and description live under `power_user.personas`
   * in the settings file — so the settings file is an import *input* rather than
   * a skipped one, and the images cannot be read until it has been.
   */
  async #readPersonas(): Promise<Personas> {
    const bytes = await this.#files.read('settings.json');
    if (bytes === null) return { names: {}, descriptions: {} };
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const power = (parsed as { power_user?: unknown }).power_user;
      if (typeof power !== 'object' || power === null) return { names: {}, descriptions: {} };
      const record = power as { personas?: unknown; persona_descriptions?: unknown };
      return {
        names: (record.personas ?? {}) as Record<string, string>,
        descriptions: (record.persona_descriptions ?? {}) as Personas['descriptions'],
      };
    } catch {
      // A broken settings file costs the personas and nothing else. One poisoned
      // file never aborts a sweep ([21 §4.1.1]).
      return { names: {}, descriptions: {} };
    }
  }

  async #read(path: string, personas: Personas): Promise<SourceItem | null> {
    const top = path.includes('/') ? (path.split('/')[0] ?? path) : path;

    // Consumed above rather than reported: it is an input, and reporting it as
    // an item would invite somebody to give it a disposition it does not have.
    //
    // **Only on a real tree**, corrected at [P4 §7.8]'s review. On a loose root
    // it is not an input to anything — there are no `User Avatars/` for it to
    // describe — so swallowing it there dropped a file from the report silently,
    // which is the one thing §1.3 says a sweep never does.
    if (path === 'settings.json' && this.kind === 'sillytavern') return null;

    if (this.kind === 'loose-files') return this.#probe(path);

    switch (top) {
      case 'characters':
        return this.#card(path);
      case 'worlds':
        return await this.#json(path, 'sillytavern.lorebook');
      case 'OpenAI Settings':
        return await this.#json(path, 'sillytavern.preset.chat');
      case 'TextGen Settings':
        return await this.#json(path, 'sillytavern.preset.text');
      case 'sysprompt':
        return await this.#json(path, 'sillytavern.preset.sysprompt');
      case 'User Avatars':
        return this.#persona(path, personas);
      /**
       * ***Chats, for the session pass*** — [P13.8]. Handed on unread, as a
       * candidate the sweep sets aside until every card is written, so a chat
       * resolves against the cards that came in beside it; the pass reads the
       * file when it reaches it. *Unread here too*, because the tree reader
       * reads what it converts and chats are most of a tree's bytes.
       */
      case 'chats':
      case 'group chats':
        return this.#chat(path);
      case 'groups':
        return this.#group(path);
      default: {
        /**
         * **`Object.hasOwn`, not a lookup**, and the difference is not
         * pedantry: the registry is an object literal, so `TABLE['constructor']`
         * answers with a *function* off `Object.prototype`, and `toString`,
         * `valueOf` and `hasOwnProperty` do the same. The old
         * `TABLE[top] ?? 'unrecognised'` had the identical hole — a directory
         * named `constructor` was given a function as its disposition, which
         * then travelled into the report and the counts.
         *
         * It matters more now, because on a loose root that lookup is also what
         * decides whether the file gets read at all: `constructor.png` would
         * have skipped the probe and refused to import for no reason anybody
         * could have found.
         */
        const byPosition = Object.hasOwn(SILLYTAVERN_DISPOSITIONS, top)
          ? SILLYTAVERN_DISPOSITIONS[top]
          : undefined;
        return observed(path, byPosition ?? 'unrecognised');
      }
    }
  }

  /**
   * A loose root's only rule: **ask the file**
   * ([P4 §7.8](../../../../../docs/design/workplan/16-p4-implementation.md)).
   *
   * **The disposition table is not consulted here at all**, and the first
   * version of this repair got that wrong in a way its own comment contradicted.
   * It said *position carries no information on a loose root* and then checked
   * the table first anyway — so a folder with a `backgrounds/`, `themes/`,
   * `assets/` or `user/` subfolder had every card in it silently skipped,
   * because those are thirty names SillyTavern happens to use. In somebody's
   * Downloads folder they are just words.
   *
   * A real tree keeps the table, and must: there `characters/` versus
   * `backgrounds/` is the whole of what tells a card from a wallpaper, and
   * [§1.8]'s *every name has a disposition* is one checkable claim precisely
   * because position decides it. The two roots now differ completely rather than
   * partly, which is easier to hold in the head and was the actual intent.
   */
  async #probe(path: string): Promise<SourceItem> {
    const bytes = await this.#files.read(path);
    if (bytes === null) {
      /**
       * ***A `.jsonl` with no bytes goes to the session pass anyway*** —
       * [P13.8]. The browser upload holds a loose folder's `.jsonl` files back
       * until the person chooses chats (`directory-upload.ts`), so an unsent
       * one is most often a choice, not a failure; the pass is what knows
       * which (`chat-sessions.ts`), and says *not chosen*, *over the limit*,
       * or *could not be read* accordingly. Answered here it could only ever
       * say the last.
       */
      if (/\.jsonl$/i.test(path)) {
        return candidate({ source: path, format: SILLYTAVERN_CHAT_FORMAT, payload: null });
      }
      // **With a note.** A noteless `unrecognised` is the exact defect §7.8
      // exists to remove, and it came straight back for anything the source
      // would not hand over — a file past `maxFileBytes`, or one that vanished
      // between the walk and the read.
      return observed(path, 'unrecognised', [
        { key: 'import.file.unreadable', params: { file: path }, level: 'warn' },
      ]);
    }
    return readUpload(path, bytes, 'high');
  }

  /**
   * A card, which is a picture with a payload in it.
   *
   * A file here that is not a card is a `warn` row and the sweep completes
   * around it — the poisoned-file rule, which the fixture corpus carries a case
   * for precisely so this path is exercised rather than assumed.
   */
  async #card(path: string): Promise<SourceItem> {
    const bytes = await this.#files.read(path);
    if (bytes === null) return observed(path, 'unrecognised');

    const codec = codecFor(bytes);
    if (codec === null) {
      /**
       * **A card that is not in a picture** — added at the P4 audit
       * ([P4 §7.1]).
       *
       * `characters/` holds PNGs by convention and JSON cards by habit:
       * SillyTavern exports both, and a card downloaded as JSON gets dropped in
       * beside the pictures. Until now that file was `notACard` with a `warn`,
       * which is a confident wrong answer about a perfectly good card — and it
       * is the same wrong answer the upload route used to give, from the other
       * direction.
       *
       * `convertCard` already takes the unwrapped object or the V2/V3 envelope,
       * so the whole fix is to look. A file here that is neither a container nor
       * a card keeps the note it had.
       */
      const asJson = readJsonCard(bytes);
      if (asJson !== null) {
        return candidate({ source: path, format: 'sillytavern.card', payload: asJson });
      }
      return observed(path, 'unrecognised', [
        { key: 'import.file.notACard', params: { file: path }, level: 'warn' },
      ]);
    }

    try {
      const legacy = codec.read(bytes).legacy;
      if (legacy === null) {
        return observed(path, 'unrecognised', [
          { key: 'import.file.pictureWithoutACard', params: { file: path }, level: 'warn' },
        ]);
      }
      return candidate({
        source: path,
        format: 'sillytavern.card',
        payload: legacy.data,
        // The pixels travel with it: the imported actor keeps the card it
        // arrived on ([P4 §1.3]).
        assets: [path],
      });
    } catch {
      return observed(path, 'unrecognised', [
        { key: 'import.file.notACard', params: { file: path }, level: 'warn' },
      ]);
    }
  }

  /**
   * A chat file where SillyTavern files them — `chats/<card>/<name>.jsonl`, or
   * `group chats/<id>.jsonl` (`endpoints/chats.js:554`, `:803`) — or, anywhere
   * else under those folders, a file SillyTavern never writes there, which is
   * counted and said rather than guessed at.
   */
  #chat(path: string): SourceItem {
    if (CHAT_FILE.test(path)) {
      return candidate({ source: path, format: SILLYTAVERN_CHAT_FORMAT, payload: null });
    }
    return observed(path, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: path }, level: 'warn' },
    ]);
  }

  /**
   * A group's own file, `groups/<id>.json`, on the same terms as a chat: handed
   * on unread to the session pass, which reads it beside the group's chats for
   * their roster, reply strategy and muted members ([P13.9]) — a few hundred
   * bytes, but only meaningful with the chats in view.
   */
  #group(path: string): SourceItem {
    if (GROUP_FILE.test(path)) {
      return candidate({ source: path, format: SILLYTAVERN_GROUP_FORMAT, payload: null });
    }
    return observed(path, 'unrecognised', [
      { key: 'import.file.unrecognised', params: { file: path }, level: 'warn' },
    ]);
  }

  async #json(path: string, format: string): Promise<SourceItem> {
    const bytes = await this.#files.read(path);
    if (bytes === null) return observed(path, 'unrecognised');
    try {
      return candidate({
        source: path,
        format,
        payload: JSON.parse(new TextDecoder().decode(bytes)),
      });
    } catch {
      return observed(path, 'unrecognised', [
        { key: 'import.file.notJson', params: { file: path }, level: 'warn' },
      ]);
    }
  }

  #persona(path: string, personas: Personas): SourceItem {
    const file = path.slice('User Avatars/'.length);
    const name = personas.names[file];
    if (typeof name !== 'string') {
      // An avatar with no entry in the settings file is a leftover image, not a
      // persona. Counted rather than converted into a nameless actor.
      return observed(path, 'skipped');
    }
    const description = personas.descriptions[file]?.description;
    return candidate({
      source: path,
      format: 'sillytavern.persona',
      payload: { name, description: typeof description === 'string' ? description : '' },
      assets: [path],
    });
  }
}

/** Where SillyTavern writes a chat: one level under `chats/<card>/`, or directly in `group chats/`. */
const CHAT_FILE = /^(?:chats\/[^/]+|group chats)\/[^/]+\.jsonl$/i;
/** `groups/<id>.json` (`endpoints/groups.js`). */
const GROUP_FILE = /^groups\/[^/]+\.json$/i;

/**
 * A JSON character card, or nothing.
 *
 * Shares `upload.ts`'s probe rather than repeating its rules, because *what
 * counts as a card* is exactly the judgement the two arms must not make
 * differently — which is the whole of what [P4 §7.1] was about.
 */
function readJsonCard(bytes: Uint8Array): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return looksLikeCard(parsed) ? parsed : null;
}

function candidate(value: ImportCandidate): SourceItem {
  return { outcome: 'candidate', candidate: value };
}

function observed(
  source: string,
  disposition: ImportDisposition,
  notes: ImportNote[] = [],
): SourceItem {
  const report: ImportItemReport = { source, disposition, notes };
  return { outcome: 'observed', report };
}
