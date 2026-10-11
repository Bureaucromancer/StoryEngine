// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { FileSet } from '@storyengine/shared';

import { megabytes } from '../../format.js';
import { SectionTitle } from '../../ui/Text.js';
import { tooLarge } from './model.js';
import { WORDS } from './words.js';

/**
 * ***What opening the file needs, and what it leaves behind*** —
 * [16 §5](../../../../../docs/design/16-publish.md),
 * [P16 §1.1](../../../../../docs/design/workplan/35-p16-world.md),
 * [P16.3g](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * - **The modes it needs**, from the Setups and sessions it carries, with this
 *   install's version of each — or the plain fact that this install does not
 *   have one, which the file then says to whoever opens it ([P16.3]'s plan,
 *   R12: the derived list goes in the manifest for the reader's warning).
 *   Mode ids, raw, as the library names things ([10 §2.1]).
 * - **Every picture too large to travel, named** — [16 §5]'s *the review names
 *   every picture that stays behind, by object*, read off the same measure the
 *   writer plans with. ***And an object whose own file is too large, named as
 *   the object*** (2026-10-11, the P16.3g review): `measureObject` lists that
 *   file in `omitted` too, and the writer leaves the whole object home, so
 *   *a picture of “Vera” (card.png …)* was the wrong thing to say of it
 *   ({@link tooLarge}).
 * - ***What a build without the reader does with it*** — the sentence
 *   [P16 §1.1] said this review owes, *corrected by trying it* against alpha 6
 *   (`words.ts` records what was seen, and the two corrections of the same
 *   day). The history half is said only when history is ticked, because only
 *   then is it true.
 */
export function FileNeeds(props: {
  set: FileSet;
  history: boolean;
  modeVersions: Readonly<Record<string, string | null>>;
}): JSX.Element {
  const omitted = props.set.objects.flatMap((object) =>
    (object.facts?.omitted ?? []).map((picture) => ({ object, picture })),
  );
  return (
    <section aria-labelledby="publish-needs" className="mb-6">
      <SectionTitle as="h2" id="publish-needs" className="mb-2">
        {WORDS.needsTitle}
      </SectionTitle>
      <ul className="flex flex-col gap-1 text-sm text-ink-subtle">
        {props.set.modes.map((mode) => {
          const version = props.modeVersions[mode] ?? null;
          return (
            <li key={mode} className="break-words">
              {(version === null ? WORDS.modeNotHere : WORDS.modeHere)
                .replace('{mode}', () => mode)
                .replace('{version}', () => version ?? '')}
            </li>
          );
        })}
        {omitted.map(({ object, picture }) => (
          <li key={`${object.key}:${picture.ref}`} className="break-words">
            {tooLarge(object)
              ? WORDS.objectTooLarge
                  .replace('{name}', () => object.name)
                  .replace('{size}', megabytes(picture.bytes))
              : WORDS.omittedPicture
                  .replace('{name}', () => object.name)
                  .replace('{ref}', () => picture.ref)
                  .replace('{size}', megabytes(picture.bytes))}
          </li>
        ))}
        <li>{WORDS.olderBuilds}</li>
        {props.history ? <li>{WORDS.olderBuildsHistory}</li> : null}
      </ul>
    </section>
  );
}
