// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useImperativeHandle, useRef, useState, type JSX, type Ref } from 'react';

import { labels } from '../i18n/catalogue.js';
import { useLibrary, useSession } from '../queries.js';
import { strip } from '../ui/classes.js';
import { Popover } from '../ui/Popover.js';
import { CastPanel, castPanelShows, focusWhoYouPlay } from './CastPanel.js';
import { ChannelHealth } from './ChannelHealth.js';
import { ChannelHud } from './ChannelHud.js';
import { GoalPanel } from './GoalPanel.js';
import { HookPanel } from './HookPanel.js';
import { isSwitch, ModeRegion } from './ModeRegion.js';
import { Portrait } from './Portrait.js';

const WORDS = labels('play.strip', {
  label: 'The story now',
  cast: 'Cast',
  here: '{here} of {all} here',
  nobody: 'nobody yet',
  // A death the engine refused, waiting on a person — `CastItem` says why it
  // is on the item (2026-10-14).
  ruling: 'The narrator has {name} as {status}. Rule on it',
  rulings: 'The narrator has {name} as {status}, and {more} more. Rule on them',
});

/** What the page may ask of the strip — see {@link HudStrip}. */
export interface HudStripHandle {
  /** Opens the cast where it is, and hands *You play* the keyboard. */
  whoYouPlay: () => void;
}

/**
 * ***The facts about now, in one line above the prose*** —
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s *"world state as a
 * strip of widgets you can edit in place"*, built at
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.4, under the
 * decisions its §0.4 records.
 *
 * **What is in it is what that plan's §1.3 called facts about the story right
 * now**: a channel that could not be loaded, first, because it is the most
 * urgent; the channels' own entries and a mode's placements (*Time*, *Place*);
 * who is in the scene, as faces; what the story is working toward; and how
 * many plot hooks are waiting. The hooks are here rather than in the workbench
 * because [10 §10.1] puts *Commit* and *Save this to…* on the play surface, and
 * §0.4 let that section win over the plan's proposal.
 *
 * **Each item opens in place**, in `ui/Popover` placed `under`: the strip is
 * the popover's containing block, so every item opens to the same place — just
 * below the strip, at the column's width, over the top of the story — and
 * nothing is a modal, a sidebar or a page. What an item opens is **the panel it
 * replaces, reused**: the cast panel, the goal panel's offers and its form, the
 * hook panel's dial, rows and form, the health banner's two offers, and for a
 * channel's entry its value and how to change it. *Nothing became harder to
 * reach than one press*, which is [P12A §1.3]'s test — and every control those
 * panels held is still found by its role and name, once its item is open.
 *
 * *Where each item is spelled.* The goal and hook panels were disclosures, so
 * each became its own item in its own file — the summary line it showed shut is
 * the trigger, and the health banner's headline is its — and the panels' tests
 * open them the same way. The cast panel never was one: its item, the faces and
 * the count, is new, and lives here as `CastItem` round the panel unchanged.
 *
 * ***What it does not hold, yet.*** The configuration panels — how a chat
 * plays, the lore, the session's pack, the dials, a mode's actions and its
 * switches — are facts about how the session is set up rather than about the
 * story now, and they move to the workbench at P12A.5. Until then they stay in
 * the column above the strip, which is why the strip sits directly over the
 * transcript: that is where P12A.5 leaves it.
 * *(2026-10-13, P12A.5: they have moved — the workbench's play subject opens
 * on them, its **Session** section — and the strip is the column's only
 * block between the heading and the prose but for* Set the scene *and the
 * two lines a session can say about itself. It gained one thing in the move:
 * **what a mode put in its `panel` region that is not a switch**, after the
 * hooks — Scene's trackers' cards, the revealed plot, the echo chamber's
 * reactions — since each is a value the story holds now, and so a fact this
 * strip is for. Each opens in place as a record placed in the strip always
 * has; `isSwitch` in `ModeRegion.tsx` is the rule that split the region.)*
 *
 * ***Why it is one strip and not a panel per fact.*** [10 §1.1]'s *where the
 * two meet, tooling gives way*: five panels stacked above the prose had pushed
 * the story down a screen, each with a good reason. A line of facts costs one
 * line, and an item that opens over the story — rather than pushing it — costs
 * nothing until somebody opens it.
 */
export function HudStrip(props: {
  sessionId: string;
  /** The reader's, for the cast panel's percentages. */
  locale: string | undefined;
  /** Whether a turn is starting or running — the goal and cast panels wait. */
  busy: boolean;
  /** *Speak*, the page's, because a turn is the page's to start. */
  onSpeak: (actorId: string) => void;
  ref?: Ref<HudStripHandle>;
}): JSX.Element {
  const session = useSession(props.sessionId);
  // The library's actors, for a member-scoped card's name — the key the cast
  // item already holds, so asking costs no request.
  const actors = useLibrary('actors');
  const [castOpen, setCastOpen] = useState(false);
  /**
   * ***Asked for *You play*, not only for the cast.*** The face on a player's
   * line opens the cast to correct who they play; the popover hands the
   * keyboard to the first control inside, which is *You play* today, and this
   * says so rather than relying on the order of a panel's rows.
   */
  const wantsWhoYouPlay = useRef(false);

  useImperativeHandle(props.ref, () => ({
    whoYouPlay: () => {
      if (castOpen) {
        focusWhoYouPlay();
        return;
      }
      wantsWhoYouPlay.current = true;
      setCastOpen(true);
    },
  }));

  // After the popover has opened and focused its first control: the strip's
  // effect runs after its child's, so this has the last word.
  useEffect(() => {
    if (!castOpen || !wantsWhoYouPlay.current) return;
    wantsWhoYouPlay.current = false;
    focusWhoYouPlay();
  }, [castOpen]);

  /**
   * ***Hidden while the session loads, not left out.*** Every item reads the
   * session itself and draws nothing without it, so the strip has nothing to
   * show yet — but an item mounted only once the session had arrived would
   * mount its read against a cache entry already stale, and a stale read on
   * mount is a refetch: a second `GET` of the session on every page load,
   * which `PlayPage.test.tsx`'s *does not keep refetching afterwards* counts.
   * So the items are there from the first render, as the panels they replace
   * were, and the strip is only hidden.
   */
  return (
    <section
      aria-label={WORDS.label}
      hidden={session.data === undefined}
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    >
      <ChannelHealth sessionId={props.sessionId} />
      <ChannelHud sessionId={props.sessionId} />
      <CastItem
        sessionId={props.sessionId}
        locale={props.locale}
        busy={props.busy}
        onSpeak={props.onSpeak}
        open={castOpen}
        onOpenChange={setCastOpen}
      />
      <GoalPanel sessionId={props.sessionId} busy={props.busy} />
      <HookPanel sessionId={props.sessionId} />
      {/* ***A mode's readings, last*** (2026-10-13, P12A.5) — the order the
          column had them in, where a mode's additions came after the engine's
          own panels. Its switches are the workbench's (`SessionSection`). */}
      <ModeRegion
        sessionId={props.sessionId}
        surfaces={(session.data?.surfaces ?? []).filter((one) => !isSwitch(one))}
        region="panel"
        drawn="line"
        nameOf={(actorId) =>
          actors.data?.objects.find((one) => one.id === actorId)?.name ?? actorId
        }
        className="contents"
      />
    </section>
  );
}

/**
 * ***Who is here, at a glance*** — the cast as the strip shows it: the faces of
 * the people present, the faces P12A.3 drew, and how many of the cast that is.
 * It opens the cast panel itself ([10 §13.2](../../../../docs/design/10-ui-surfaces.md)),
 * where presence and status are corrected and *You play* is chosen.
 *
 * **Present, not every row**, because *who is here* is the fact about now; the
 * count says how many are not. *Four faces at most*, since a strip item is a
 * line and a crowd scene has more people than a line has room for — the count
 * carries the rest. Drawn for exactly the sessions the panel is drawn for
 * (`castPanelShows`), so the item and the panel cannot disagree about whether
 * there is a cast.
 *
 * ***The faces are named for who they are*** (2026-10-14,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)'s final audit),
 * in the register of `PlayedAs`'s *named where nothing beside it names it*. A
 * face is decorative when its name is beside it or on what holds it, and
 * nothing on this item named who was present: the faces were `aria-hidden`, so
 * a sighted reader saw at a glance who was in the scene and a screen reader
 * heard *Cast, 1 of 2 here* — though identity is the one claim P12A.3's faces
 * exist to make. So the group of faces is an image named by the people it
 * draws, each face still hidden inside it. *The four drawn, not everyone
 * present*: the count carries the rest, as it does for sight.
 *
 * ***A death the narrator proposed and the engine refused is said on the
 * item*** (2026-10-14, P12A's final audit). [06 §8.1] and
 * [10 §13.2](../../../../docs/design/10-ui-surfaces.md) owe a refused death a
 * prominent surface — *"a false one silently removes someone from the
 * story"* — and the cast panel's `Alert` was that surface while the panel
 * stood open in the column. Since P12A.4 the panel is a press away, and the
 * item said *3 of 3 here* exactly as before: nothing on Play said a ruling was
 * waiting, the next turns were assembled with the character present while the
 * prose had them dead, and *Confirm* and *Not so* were seen only by someone
 * who happened to open the cast. So while a row is pending the item takes the
 * strip's warning tone — `ChannelHealth`'s, and `GoalPanel`'s waiting
 * completion outranking its statement is the same move — and says the first
 * ruling on the line, with how many more; the rulings themselves stay in the
 * panel, one press away. *"Cast" takes the warning's ink there*, not
 * `strip.label`'s: `warn-ink` on `warn-surface` is a pair `contrast.test.ts`
 * measures, `ink-subtle` on it is not. And the sentence is copied into a live
 * region beside the item, mounted empty so it is listening when a finished
 * turn brings the refusal — beside and not round the item, for
 * `ChannelHealth`'s reason: round it, the panel would be read out on every
 * open.
 */
function CastItem(props: {
  sessionId: string;
  locale: string | undefined;
  busy: boolean;
  onSpeak: (actorId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
  const session = useSession(props.sessionId);
  const actors = useLibrary('actors');
  const rows = session.data?.cast ?? [];
  if (!castPanelShows(rows, session.data?.chat, session.data?.session.cast)) return null;

  const here = rows.filter((row) => row.presence);
  const cards = actors.data?.objects ?? [];
  // The name `CastPanel` gives a row: the card's, or the id when it has gone.
  const nameOf = (actorId: string): string =>
    cards.find((one) => one.id === actorId)?.name ?? actorId;
  const drawn = here.slice(0, 4).map((row) => ({
    row,
    card: cards.find((one) => one.id === row.actorId),
    name: nameOf(row.actorId),
  }));
  const count =
    rows.length === 0
      ? WORDS.nobody
      : WORDS.here
          .replace('{here}', () => String(here.length))
          .replace('{all}', () => String(rows.length));
  const pending = rows.filter((row) => row.pending !== null);
  const ruling = pending[0];
  const sentence =
    ruling === undefined
      ? null
      : (pending.length === 1 ? WORDS.ruling : WORDS.rulings)
          .replace('{name}', () => nameOf(ruling.actorId))
          .replace('{status}', () => ruling.pending ?? '')
          .replace('{more}', () => String(pending.length - 1));

  return (
    <div>
      <span role="status" className="sr-only">
        {sentence ?? ''}
      </span>
      <Popover
        place="under"
        label={WORDS.cast}
        open={props.open}
        onOpenChange={props.onOpenChange}
        triggerClassName={sentence === null ? strip.item : strip.warn}
        trigger={
          <>
            <span className={sentence === null ? strip.label : undefined}>{WORDS.cast}</span>{' '}
            {drawn.length === 0 ? null : (
              <span
                role="img"
                aria-label={drawn.map((one) => one.name).join(', ')}
                className="flex gap-0.5"
              >
                {drawn.map((one) => (
                  <Portrait
                    key={one.row.actorId}
                    actorId={one.row.actorId}
                    actor={one.card}
                    name={one.name}
                    size="row"
                  />
                ))}
              </span>
            )}{' '}
            <span>{count}</span>
            {sentence === null ? null : (
              <>
                {' '}
                <strong>{sentence}</strong>
              </>
            )}
          </>
        }
      >
        <CastPanel
          sessionId={props.sessionId}
          locale={props.locale}
          busy={props.busy}
          onSpeak={props.onSpeak}
        />
      </Popover>
    </div>
  );
}
