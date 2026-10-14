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
import { Portrait } from './Portrait.js';

const WORDS = labels('play.strip', {
  label: 'The story now',
  cast: 'Cast',
  here: '{here} of {all} here',
  nobody: 'nobody yet',
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
  const count =
    rows.length === 0
      ? WORDS.nobody
      : WORDS.here
          .replace('{here}', () => String(here.length))
          .replace('{all}', () => String(rows.length));

  return (
    <Popover
      place="under"
      label={WORDS.cast}
      open={props.open}
      onOpenChange={props.onOpenChange}
      triggerClassName={strip.item}
      trigger={
        <>
          <span className={strip.label}>{WORDS.cast}</span>{' '}
          {here.length === 0 ? null : (
            <span aria-hidden="true" className="flex gap-0.5">
              {here.slice(0, 4).map((row) => {
                const card = cards.find((one) => one.id === row.actorId);
                return (
                  <Portrait
                    key={row.actorId}
                    actorId={row.actorId}
                    actor={card}
                    name={card?.name ?? row.actorId}
                    size="row"
                  />
                );
              })}
            </span>
          )}{' '}
          <span>{count}</span>
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
  );
}
