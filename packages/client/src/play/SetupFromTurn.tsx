// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Note } from '../ui/Text.js';

/**
 * ***Make a setup from here*** — [04 §7.2](../../../../docs/design/04-schemas.md),
 * [17 §3](../../../../docs/design/17-authoring.md),
 * [P15.8](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **Beside *Continue from here*, and the other answer to the same wish.**
 * Continuing from a turn keeps the whole history behind it; this condenses that
 * history into a Setup — a story so far, an opening, the party, the goal, the
 * hooks, and the facts play established — which a new session starts from, and
 * which travels in a package without a turn record behind it.
 *
 * ***The button is here and the dialog is not*** (2026-10-04,
 * [P15 §1.11](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md),
 * [21 §7.2](../../../../docs/design/21-client-loading.md)). Every turn of every
 * transcript draws this button, so it has to be on the play page's code; the
 * dialog behind it is seen by somebody who pressed it on one turn, and until
 * this date every byte of it was on the common entry — paid for by a first load
 * of the sign-in page, the library and Settings alike. P15's merge raised the
 * entry's ceiling to make room for it rather than decide that, and named the
 * wizard the plainest candidate yet for the client's first `lazy()`. This is
 * that decision: the dialog is `SetupWizard.tsx`, a chunk of its own, fetched
 * the first time anybody presses the button and never before. *Lazy at the
 * dialog rather than at the button*, because a lazy button would be fetched the
 * moment a transcript drew its first turn, which is a smaller entry and the
 * same download on every visit to play.
 *
 * ***A hook that hands back two pieces, rather than a component that draws
 * one*** (2026-10-04, in review). The button belongs in the turn's row of
 * gestures, and that row fades unless the turn is hovered or holds focus
 * (`reveal`, `ui/classes.ts`) — so what the button opens cannot be drawn inside
 * it. The wizard's waiting sentence and its failure note were, at first, as
 * siblings of the button: on any device that can hover, *the setup wizard could
 * not be loaded* was invisible unless the pointer was over that turn, and the
 * note's own advice — send or copy what you typed — moves the pointer and focus
 * to the composer, which hid the note while it was still saying something.
 * `PlayPage.tsx` had already written the rule down for the guided redo's field,
 * *a field that vanished when the pointer left it would be a field nobody could
 * read back*, and placed that field after the row. So this returns the
 * `trigger`, for the row, and the `place`, for after it: `TurnView` puts each
 * where it belongs, and the state both share — whether the wizard is open, and
 * where focus goes back to — stays here rather than in a component that draws
 * eleven other things. `PlayPage.test.tsx`'s *opens the wizard outside the row
 * that fades* holds the placement.
 */
export function useSetupFromTurn(props: { sessionId: string; turnId: string; busy: boolean }): {
  trigger: JSX.Element;
  place: JSX.Element | null;
} {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /**
   * ***Whether closing should hand focus back to the button*** — `TwoStep`'s
   * pattern, and needed by one way of closing only. The dialog's own close
   * already returns focus: `Dialog`'s `useFocusTrap` remembers what was focused
   * when it opened, which is this button, and restores it as it unmounts. The
   * failure note has no trap, so its *Dismiss* unmounts the very button that
   * held focus and the browser drops focus to `<body>` — the *"where did my
   * keyboard go"* bug `useFocusTrap.ts` is written against, and in a long
   * transcript a keyboard or screen-reader user's place in the story gone with
   * it. So *Dismiss* asks for focus back, and the dialog's close leaves it to
   * the trap that already does it — one owner for each way out.
   */
  const returning = useRef(false);

  useEffect(() => {
    if (open || !returning.current) return;
    returning.current = false;
    button.current?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
  };
  const dismiss = (): void => {
    returning.current = true;
    setOpen(false);
  };

  return {
    trigger: (
      <Button
        ref={button}
        type="button"
        disabled={props.busy}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        Make a setup from here
      </Button>
    ),
    place: open ? (
      <WizardLoad onDismiss={dismiss}>
        <Suspense fallback={<Note role="status">Opening the setup wizard…</Note>}>
          <SetupWizard sessionId={props.sessionId} turnId={props.turnId} onClose={close} />
        </Suspense>
      </WizardLoad>
    ) : null,
  };
}

/**
 * ***The wizard's chunk did not arrive*** — the one failure a reload answers,
 * told apart from every other by its type rather than by its message, which is
 * the browser's and differs between them.
 */
class WizardChunkError extends Error {
  constructor(cause: unknown) {
    super('The setup wizard’s code could not be loaded.', { cause });
    this.name = 'WizardChunkError';
  }
}

/**
 * ***The dialog, fetched when it is first wanted*** — and declared here, at
 * module scope, because [React's `lazy`](https://react.dev/reference/react/lazy)
 * caches what it loads on the declaration: one declared inside a component
 * would be a new boundary every render and fetch again each time.
 *
 * *A named export mapped to `default`* rather than a default export added to
 * the wizard, so the module keeps the one export style the client uses and its
 * tests import it by name.
 *
 * ***The rejection is wrapped*** (2026-10-04, in review), because `lazy` throws
 * whatever the import rejected with to the boundary below, and that boundary
 * also catches the dialog's own render once the chunk is in. Wrapped here — the
 * one place that knows the failure is a *load* — the boundary can say *reload*
 * to the failure a reload fixes and something plainer to a bug in the dialog,
 * which a reload would only repeat.
 */
const SetupWizard = lazy(() =>
  import('./SetupWizard.js').then(
    (module) => ({ default: module.SetupWizard }),
    (cause: unknown) => {
      throw new WizardChunkError(cause);
    },
  ),
);

/**
 * ***What the turn shows while the dialog is on its way, and if it never
 * arrives or fails once it has.***
 *
 * **Waiting is a sentence under the turn's gestures, not a dialog** — the
 * *Suspense* fallback above. A modal frame drawn while the code loads would
 * have its own focus trap and buttons, and the real dialog replacing it could
 * remember one of those buttons as the place to hand focus back to — gone by
 * the time the dialog closes, so focus would land on nothing. And nothing is
 * covered while the chunk is on its way, so there is nothing to close: the
 * transcript, the composer and the other turns' buttons all stay in reach. On a
 * LAN the sentence is there for a moment; [21 §7.1]'s contingency for the
 * changelog said the same of its own fallback — *a sentence rather than a
 * spinner*.
 *
 * **A failure says so here, and nowhere else breaks.** `lazy` throws its load's
 * rejection to the nearest error boundary, and without this one the nearest is
 * the router's `RouteErrorCard`, which would swap the whole play page —
 * transcript, composer, an unsent move — for *This page could not be rendered*
 * over one dialog. [21 §5](../../../../docs/design/21-client-loading.md): *"a
 * failed inspector should leave the page beside it usable."* *A class
 * component, which `router.tsx` argues against for the page-sized case* because
 * a hand-rolled boundary forgets to reset on navigation; this one cannot
 * outlive what it guards, because *Dismiss* closes the wizard and unmounts it,
 * and leaving the page unmounts it too.
 *
 * ***It guards the dialog's render as well as its load, and says which***
 * (2026-10-04, in review). The boundary wraps everything the wizard draws, so
 * an exception thrown while rendering it, once the chunk is in, lands here too
 * — and 21 §5's sentence holds for a bug as much as for a missing file, so it
 * is caught rather than handed on to the router's card. What differs is the
 * advice: *only a `WizardChunkError` is told to reload*. Telling somebody whose
 * dialog hit a bug that StoryEngine was probably updated, and to reload, would
 * misdiagnose it and send them to a remedy that reproduces it.
 *
 * ***No Try again, and no Reload button, each for its reason.*** `lazy` caches
 * the rejection as it caches a success, so a retry through the same
 * declaration fails the same way without asking the network; and the likelier
 * cause on a self-hosted install is the one 21 §5 names — an upgrade replaced
 * the server while this tab was open, and the chunk this tab knows by name is
 * gone — which only a reload answers. A button that reloads would also discard
 * a move typed and not sent, which is not persisted, so the sentence says what
 * to do and the person chooses when.
 */
class WizardLoad extends Component<
  { onDismiss: () => void; children: ReactNode },
  { failed: 'chunk' | 'render' | null }
> {
  override state: { failed: 'chunk' | 'render' | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: 'chunk' | 'render' } {
    return { failed: error instanceof WizardChunkError ? 'chunk' : 'render' };
  }

  override render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <AlertNote role="alert">
        <span className="me-2">
          {this.state.failed === 'chunk'
            ? 'The setup wizard could not be loaded. If StoryEngine was updated since this page was opened, reload the page to fetch the new version — after sending or copying anything you have typed, which a reload does not keep.'
            : 'The setup wizard stopped with an error. The rest of the page is unaffected.'}
        </span>
        <Button type="button" variant="quiet" size="compact" onClick={this.props.onDismiss}>
          Dismiss
        </Button>
      </AlertNote>
    );
  }
}
