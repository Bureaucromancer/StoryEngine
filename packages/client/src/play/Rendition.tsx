// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { literalSpans } from '@storyengine/shared';

import { renditionAssetUrl, type IllustrationMode, type Rendition } from '../api.js';
import { useWriteChannel } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { SelectField } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';
import { disclosure } from '../ui/classes.js';

/**
 * A picture, where the picture goes —
 * [06 §10.4a](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §2.3](../../../../docs/design/10-ui-surfaces.md), [P9.4].
 *
 * ***Three states and none of them is an empty frame.*** [10 §2.3] names the
 * temptation this feature brings — *"a placeholder where the picture would go,
 * and there should not be one"* — and it is right about the **backdrop**, where
 * off means the surface is the one it was before. An **illustration** is
 * different: a turn that asked for a picture and has not got one yet is a turn
 * whose reader is waiting, and saying so is not an empty state to fill. So this
 * renders a line of text while pending, a line and a retry when failed, and the
 * picture when there is one.
 *
 * ***`asset: null` renders as regenerable rather than broken***, which is
 * [P9 §1.4]'s whole contingency: *"an eviction policy can be adopted later
 * because adopting one can never cost history — that holds only if `asset: null`
 * renders as a regenerable placeholder rather than a broken image."* A phase
 * that shipped pixels without this has quietly made eviction a migration.
 */

export interface RenditionProps {
  sessionId: string;
  rendition: Rendition;
  /** Pressed on the placeholder, and on anything with no pixels. */
  onRetry: (renditionId: string) => void;
  busy?: boolean;
}

export function RenditionView(props: RenditionProps): JSX.Element {
  const { rendition } = props;

  if (rendition.state === 'ready' && rendition.asset !== null) {
    return (
      <img
        src={renditionAssetUrl(props.sessionId, rendition.id, rendition.asset.digest)}
        /**
         * **Empty alt, deliberately.** The picture is *of* the prose beside it,
         * so a screen reader that announced a generated description would be
         * reading the same moment twice — and there is no honest description to
         * give: what the record holds is the prompt, which is what was asked for
         * rather than what came back.
         */
        alt=""
        className="my-3 max-w-full rounded-control"
      />
    );
  }

  return (
    <div className="my-3 rounded-control border border-line bg-surface-muted px-3 py-2">
      {rendition.state === 'pending' ? (
        <Fine>Making a picture of this…</Fine>
      ) : (
        <div className="flex items-center gap-3">
          <Fine>{reasonOf(rendition)}</Fine>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            disabled={props.busy === true}
            onClick={() => {
              props.onRetry(rendition.id);
            }}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Why there are no pixels, in the reader's own language.
 *
 * ***The class is what crossed the wire, and the sentence is written here***, on
 * [21 §1.4]'s rule: the server does not know the reader's language, so a failure
 * travels as something a client can render and the provider's own words go to
 * the log. This is the client rendering it.
 *
 * *An evicted rendition is `ready` with no asset*, which is why that case is
 * separate from `failed`: nothing went wrong, the pixels were reclaimed, and the
 * recipe is right there — [25 E3]'s *"evict pixels, keep recipes, regenerate on
 * demand"*.
 */
function reasonOf(rendition: Rendition): string {
  if (rendition.state === 'ready') return 'The picture was cleared to save space.';
  switch (rendition.error) {
    case 'no-binding':
      return 'Nothing is set up to make pictures.';
    case 'interrupted':
      return 'The server restarted while this was being made.';
    case 'terminal':
      return 'The image service refused this one.';
    default:
      return 'That did not come out.';
  }
}

/**
 * Where a picture goes inside a message — [06 §10.4a].
 *
 * ***The anchor is a verbatim quote and resolves at render time***, which is
 * that section's decision and not a shortcut: mentions use `{ start, end }`
 * because the scan that produced them can be re-run when the text is edited, and
 * *"a rendition has no scan to re-run — the call that wrote the anchor is
 * deliberately not made twice"*. So it holds words and looks for them now.
 *
 * ***And a miss is ordinary.*** *"A model paraphrases. A message is edited
 * afterwards, which the turn tree makes routine. A sentence occurs twice."* So
 * an anchor that does not resolve does not fail anything: the picture goes at
 * the **end** of the message, which is where it would have gone before this
 * field existed. *First match wins on a repeat*, per §10.4a.
 *
 * Returns the split point as a character offset, or null for *at the end*.
 */
export function anchorOffset(text: string, anchor: string | undefined): number | null {
  if (anchor === undefined || anchor.trim() === '') return null;

  /**
   * `literalSpans` is the scanner's, shared from `@storyengine/shared` — the
   * same function the lore page highlights with. **Not a bare `indexOf`**,
   * because that one is what the retriever's key matching was deliberately
   * moved away from: this handles the word-boundary question once, in the place
   * both readers of it agree.
   */
  const found = literalSpans(text, anchor.trim(), { wholeWords: false, caseSensitive: false });
  const first = found[0];
  if (first === undefined) return null;

  /**
   * **After the sentence, not before it.** §10.4a says the anchor names *"the
   * sentence the picture is of"*, and a picture inserted before its own sentence
   * reads as an illustration of what comes next. So the split is the end of the
   * match, carried forward to the end of the sentence it landed in — a picture
   * mid-sentence is worse than a picture one sentence late.
   */
  const rest = text.slice(first.end);
  const stop = rest.search(/[.!?](\s|$)/);
  return stop === -1 ? null : first.end + stop + 1;
}

/**
 * Which of a turn's pictures is showing — [06 §10.7], [P9.4].
 *
 * ***Siblings, never a replacement.*** §10.7's first policy is that
 * *"regeneration must never be a destructive act on something the user liked"*,
 * so **Illustrate** on a turn that already has one adds a second record rather
 * than overwriting the first, and this row is the only thing that makes the
 * difference visible. With one picture it renders nothing at all: a chooser
 * between one option is furniture.
 *
 * *Numbered rather than thumbnailed*, which is the cheap end of the same
 * affordance — a strip of previews is a gallery, and [24 §3.3] puts the
 * storyboard surface outside 1.0. The numbers are the order they were made in,
 * which is the one ordering the record actually carries.
 */
export function RenditionChooser(props: {
  renditions: readonly Rendition[];
  selectedId: string;
  onSelect: (renditionId: string) => void;
  busy?: boolean;
}): JSX.Element | null {
  if (props.renditions.length < 2) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Fine>Versions</Fine>
      {props.renditions.map((one, index) => (
        <Button
          key={one.id}
          type="button"
          variant="quiet"
          size="compact"
          disabled={props.busy === true || one.id === props.selectedId}
          aria-current={one.id === props.selectedId}
          onClick={() => {
            props.onSelect(one.id);
          }}
        >
          {String(index + 1)}
        </Button>
      ))}
    </div>
  );
}

/**
 * Whether this session makes pictures — [06 §10.6], [P9.4].
 *
 * ***A section of the Session panel rather than an eighth panel***, which is
 * exactly the move [P8.4] made for memories and for the reason that file's
 * docstring records: the column is already too long, *one Session panel, not
 * three* is still owed, and a stage that added to the column without saying so
 * is how a column becomes a list.
 *
 * ***Three values rather than a switch***, because [06 §10.6] asks for three,
 * and `on-demand` is the one that matters: *the manual **Illustrate** action
 * works and nothing runs on its own* is what somebody paying per image actually
 * wants, and it is not expressible as on-or-off.
 *
 * **Off by default and on the screen anyway.** `ILLUSTRATE_CHANNEL` defaults to
 * `off` because an image is somebody's own GPU or their own money; what keeps
 * that honest rather than hiding the feature is this control existing either
 * way, which is [work plan §2.3]'s rule that configuration without a surface is
 * not configuration.
 *
 * *The backdrop's switch is not here.* It is Scene's — `se.backdrop.on` is
 * declared by the mode that has somewhere to put a picture — so it arrives
 * through `ModeRegion`'s `panel` region like any other mode surface, and a mode
 * with no backdrop shows nothing rather than a control that does nothing.
 */
export function RenditionSection(props: {
  sessionId: string;
  /**
   * The session's rendition settings, **read by the panel and handed down**.
   *
   * *A prop and not a `useSession` of its own*, which is the client's standing
   * rule — *"queries live at the page, results thread down as props"* — and
   * which this component learned the hard way: a second `useSession` observer
   * mounting under the play page is a second fetch of the session on every
   * mount, and `PlayPage.test.tsx`'s *does not keep refetching afterwards*
   * counts them.
   */
  renditions: { illustration: IllustrationMode; backdrop?: boolean } | undefined;
}): JSX.Element | null {
  const write = useWriteChannel(props.sessionId);

  const held = props.renditions;
  if (held === undefined) return null;

  return (
    <details className="rounded-panel border border-line">
      <summary className={`${disclosure.titled} px-3 py-2 text-sm`}>Pictures</summary>

      <div className="flex flex-col gap-4 border-t border-line p-3">
        <Note>
          Pictures are made by whatever you have bound to the image role, on your own machine or
          wherever you pointed it. Nothing is made until you ask for it.
        </Note>

        <SelectField
          label="Illustrate the story"
          hint="On demand means the Illustrate button works and nothing runs on its own."
          value={held.illustration}
          options={[
            ['off', 'Never'],
            ['on-demand', 'Only when I ask'],
            ['each-turn', 'Every turn'],
          ]}
          onChange={(value) => {
            write.mutate({ key: SE_ILLUSTRATE, value });
          }}
        />

        {write.isError ? <Alert tone="error">{write.error.message}</Alert> : null}
      </div>
    </details>
  );
}

/**
 * The channel the control writes.
 *
 * *A literal rather than an import*, which is the split the whole client
 * follows: `DialPanel` spells `se.difficulty` and `Suggestions` spells
 * `se.suggest`, because the browser has neither the registry nor any business
 * importing the server. `mode-loader.test.ts` is where the engine's side is
 * pinned; this side is pinned by the component test.
 */
const SE_ILLUSTRATE = 'se.illustrate';
