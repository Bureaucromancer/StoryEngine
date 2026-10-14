// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { Button } from '../ui/Button.js';

/**
 * ***Section jumps: a heading that says it is there, and a chip for each one
 * that does*** (2026-10-13) — [P12A](../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.7, under its §0.4, and [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s
 * *editors navigated by section jumps, not tabs*.
 *
 * **The stage asked for chips generated rather than hand-listed, so that a
 * schema change cannot leave a jump pointing at nothing**, and §0.4's audit
 * found nothing to generate them from: no section in any of the four editors
 * carried an id, and only `LoreEntry`'s schema has banners, so chips taken
 * from `groupsOf` would have been empty for five kinds of six. Settings'
 * contents are the prior art and the thing not to copy here — `SECTIONS` in
 * `settings/contents.tsx` is a list beside the page, held in step by a test
 * that fails when the two drift. That is the right shape for a page with a
 * fixed set of sections and an address for each. An editor's sections are
 * not fixed: an actor has as many as its card carries, a lorebook grows a
 * set of seven while an entry is selected and loses them when it is not, and
 * a folder table that has no folders is not drawn at all.
 *
 * **So the heading is the list.** A {@link JumpSection} draws the
 * `<section>` and its heading together, and the heading tells the frame it is
 * there as it is drawn and that it is gone as it goes. The chip's words are
 * the heading's own `title` — one string, so the two cannot disagree — and
 * the chip holds the heading element itself rather than an id to look up, so
 * a chip exists exactly as long as the thing it jumps to. *A chip cannot point
 * at nothing* is that, by construction, rather than a test's promise.
 *
 * **Never tabs**, and there is no tab role anywhere in the client — which
 * `jumps.test.tsx` holds over every editor drawn and over the source, read as
 * text (so this sentence does not spell the attribute it is about). A tab
 * hides every section but one;
 * a chip hides nothing and only moves the page, which is the only version
 * [10 §1.1](../../../../docs/design/10-ui-surfaces.md)'s rule against
 * reflexive disclosure and [10 §11.2d]'s *the editor's shape is the schema's
 * shape* both allow.
 */

/** One section the frame can jump to: the words its chip says, and where it lands. */
export interface Jump {
  /** The heading's id — `useId`'s, so stable for as long as the heading is drawn. */
  id: string;
  title: string;
  heading: HTMLElement;
}

type Register = (jump: Jump) => () => void;

/**
 * Null outside a frame, which is not an error: `HookList` and `MembersField`
 * are drawn alone by their own tests, and a heading with nobody to tell is
 * still a heading.
 */
const Registry = createContext<Register | null>(null);

/** What `EditorFrame` provides — the frame is the one owner of the list. */
export const JumpRegistry = Registry.Provider;

/**
 * ***The headings registered under one frame, in the page's order.***
 *
 * **Sorted by where each heading is in the document, not by when it said so.**
 * Registration happens in effects, children before parents and a late arrival
 * last: the selected entry's seven groups register when an entry is chosen,
 * after the hooks fold that stands below them, and a list kept in arrival
 * order would put their chips after its. The page's order is the order a
 * reader meets the sections in, so it is the order the chips are in.
 *
 * *Removed by identity, added over its id*: a heading renamed — an actor's
 * section retitled, an entry renamed — runs its effect's cleanup and then the
 * effect again, so its old record goes and the new one takes its place, with
 * its chip moved if the page's order says so.
 */
export function useJumpRegistry(): { jumps: readonly Jump[]; register: Register } {
  const [jumps, setJumps] = useState<readonly Jump[]>([]);
  const register = useCallback<Register>((jump) => {
    setJumps((was) => [...was.filter((one) => one.id !== jump.id), jump].sort(inPageOrder));
    return () => {
      setJumps((was) => was.filter((one) => one !== jump));
    };
  }, []);
  return { jumps, register };
}

function inPageOrder(a: Jump, b: Jump): number {
  return a.heading.compareDocumentPosition(b.heading) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * ***Where a jump lands***, and why it is the heading.
 *
 * **Focusable but not in the tab order** (`tabIndex={-1}`), `SettingsAnchor`'s
 * rule: the jump hands the heading the keyboard, so a keyboard user's next Tab
 * goes on from the section they were taken to rather than from a chip that is
 * now a screen away, and a screen reader starts reading at the section's
 * name. The ring shows only for a jump made from the keyboard, which is when
 * it says something. `scroll-mt-4` so the heading does not land flush against
 * the top of the scrollport.
 */
const LANDS =
  'scroll-mt-4 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus';

/**
 * ***A heading the frame's chips can reach*** — for the places a heading
 * stands inside something that is not a `<section>`: an actor's sections are
 * `<fieldset>`s whose `<legend>` holds it, and a lore entry's groups are
 * `<details>` whose `<summary>` does. Everywhere else {@link JumpSection}
 * draws one of these for you.
 *
 * `title` is what the chip says and, unless `children` says more, what the
 * heading says: a lore entry's group heading carries its closed-section
 * summary — *Timing (sticky 4)* — and its chip says *Timing*, the schema's
 * word for it. `className` is the heading's whole look, because the places
 * that use this directly give it different ones — a subsection step, or
 * nothing, so that it takes the look of the legend or the summary that holds
 * it. A heading in a `<summary>` is kept on the disclosure marker's line by
 * `index.css`; one in a `<legend>` says `inline` itself.
 */
export function JumpHeading(props: {
  title: string;
  as: 'h2' | 'h3' | 'h4';
  className?: string;
  /** The heading's id, when something outside it needs to name it — see {@link JumpSection}. */
  id?: string;
  children?: ReactNode;
}): JSX.Element {
  const own = useId();
  const id = props.id ?? own;
  const heading = useRef<HTMLHeadingElement>(null);
  const register = useContext(Registry);
  const { title } = props;
  useEffect(() => {
    const element = heading.current;
    if (register === null || element === null) return undefined;
    return register({ id, title, heading: element });
  }, [register, id, title]);
  const Tag = props.as;
  return (
    <Tag
      id={id}
      ref={heading}
      tabIndex={-1}
      className={props.className === undefined ? LANDS : `${LANDS} ${props.className}`}
    >
      {props.children ?? props.title}
    </Tag>
  );
}

/**
 * ***A section of an editor, with the heading that names it*** — what replaces
 * every `<section>` and `SectionTitle` pair in the four editors.
 *
 * **The heading is drawn here rather than handed in**, which is the point of
 * the component rather than a convenience: a section whose heading somebody
 * forgot to register is the chip pointing at nothing this stage exists to rule
 * out, so there is no way to draw the one without the other. The section is
 * labelled by its heading (`aria-labelledby`), so it is a region a screen
 * reader can list, named by the same words the chip says.
 *
 * *One shape for the heading row*, where the sections had grown five: the
 * heading with its `note` held under it, and an `aside` beside them — the
 * entry list's *New entry*, the selected entry's gate note — pushed to the far
 * edge. The section's own `className` sets how its parts stand apart, and the
 * default is the gap most of them had.
 */
export function JumpSection(props: {
  title: string;
  /** `h3` for a section inside another — the selected entry, under the book. */
  as?: 'h3';
  /** The subsection step, for a section that sits among smaller headings than its level's. */
  small?: true;
  /** The section's sentence about itself, held to its heading. */
  note?: ReactNode;
  /** A control or a fact about the whole section, beside its heading. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <section aria-labelledby={id} className={props.className ?? 'flex flex-col gap-3'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <JumpHeading
            id={id}
            title={props.title}
            as={props.as ?? 'h2'}
            className={
              props.small === undefined && props.as === undefined
                ? 'text-section text-ink'
                : 'text-subsection text-ink'
            }
          />
          {props.note}
        </div>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

/**
 * ***Take the reader to a section***, opened, and give its heading the
 * keyboard.
 *
 * **Every `<details>` around the heading is opened first**, because a jump
 * into a closed one would scroll to a heading whose section is folded shut —
 * the chip would have done half of what it says. That is §0.4's decision, and
 * it is the DOM's `open` rather than React's: the folds it reaches are
 * uncontrolled on purpose (`EntryFields`' docstring says why at length), so a
 * fold opened here stays open, and one the reader shuts again stays shut. The
 * summary of a fold is drawn while it is closed, so a lore entry's group
 * heading is visible either way; it is opened all the same, because the
 * fields are what the reader came for.
 *
 * ***The scroll moves only if motion is wanted*** — read from the token the
 * reduced-motion block in `index.css` zeroes, `--transition-duration-arrive`,
 * rather than from a second media query here that could disagree with it. A
 * smooth scroll is the browser's, and no token sets its length; what the token
 * decides is whether it moves at all. With the preference set, or with no
 * stylesheet to read, the page is simply there — T5's *absent, not merely
 * fast*, and the cheaper mistake when the answer cannot be read.
 *
 * *Focus without a scroll of its own*, so it neither cuts the smooth scroll
 * short nor fights the `scroll-mt-4` the heading lands with.
 */
export function jumpTo(heading: HTMLElement): void {
  for (
    let fold = heading.closest('details');
    fold !== null;
    fold = fold.parentElement?.closest('details') ?? null
  ) {
    fold.open = true;
  }
  const arrive = getComputedStyle(document.documentElement).getPropertyValue(
    '--transition-duration-arrive',
  );
  heading.scrollIntoView({ block: 'start', behavior: parseFloat(arrive) > 0 ? 'smooth' : 'auto' });
  heading.focus({ preventScroll: true });
}

/**
 * ***The chips***, over the form and under the object's name — one per
 * registered heading, in the page's order, and nothing at all for a page with
 * none.
 *
 * **Buttons, not links into the address.** Settings' rows are links because
 * there the address is the jump ([10 §3]'s *jump, not tab*): a section there
 * has a fixed anchor, and a link to it can be pasted and reloaded. Here the
 * ids are `useId`'s — stable for as long as the page is drawn and not across
 * loads — and an editor's sections come and go with what is selected, so a
 * pasted `#…` would be an address that lands nowhere after a reload. The
 * dock's jumps (`workbench/jump.ts`) are the precedent: an element, not a
 * route, and a scroll and a focus with nothing remembered. The editor's
 * address keeps what it already says — `?entry=`, `#aliases`.
 *
 * **Not pinned to the top of the scrollport.** A row of a dozen chips on a
 * phone is two or three lines, and held over the form it would be that much
 * less form on every screen of it — a shrunken panel by another name, which
 * [P12A.8]'s phone rules refuse. The critical controls already hold the bottom
 * edge (`page.actions`); the chips stand where the page starts, and the top
 * of the page is one keystroke away.
 *
 * `ui/Button`, compact, so a chip is a button like the page's others and
 * acknowledges its press as they do ([P12A.6]'s `press`).
 */
export function JumpChips(props: { jumps: readonly Jump[] }): JSX.Element | null {
  if (props.jumps.length === 0) return null;
  return (
    <nav aria-label="Jump to a section" className="mb-6">
      <ul className="flex flex-wrap gap-2">
        {props.jumps.map((jump) => (
          <li key={jump.id}>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                jumpTo(jump.heading);
              }}
            >
              {jump.title}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
