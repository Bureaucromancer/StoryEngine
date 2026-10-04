// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type JSX } from 'react';

import {
  draftSetupFromTurn,
  listModes,
  saveSetupFromTurn,
  type SetupCarryPreview,
  type SetupDraft,
  type SetupFromTurn as SetupFromTurnBody,
  type SetupPart,
  type SetupPartOutcome,
  type SetupPartRefusal,
} from '../api.js';
import { remedySentence } from '../failures.js';
import { labels } from '../i18n/catalogue.js';
import { StartSession } from '../library/StartSession.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { CheckboxField, Field } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import { Fine, SectionTitle, SubsectionTitle } from '../ui/Text.js';

/**
 * ***Make a setup from here*** — [04 §7.2](../../../../docs/design/04-schemas.md),
 * [16 §3](../../../../docs/design/16-authoring.md),
 * [P15.8](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **Beside *Continue from here*, and the other answer to the same wish.**
 * Continuing from a turn keeps the whole history behind it; this condenses that
 * history into a Setup — a story so far, an opening, the party, the goal, the
 * hooks, and the facts play established — which a new session starts from, and
 * which travels in a package without a turn record behind it.
 *
 * ***One dialog with sections, not a stepper.*** [10 §1.1] rejects steppers on
 * tooling surfaces, and [10 §6] endorses a wizard for setup flows; what both
 * want is a person who can see everything they are about to save at once. So
 * every section drafts on open, each says whether its draft landed, and each can
 * be redrafted on its own — *Regenerate*, with a note if somebody has one —
 * without discarding the others, which is the route's own per-part shape.
 *
 * **Offered, never automatic, and reviewed before it lands** ([16 §3]):
 * nothing is written until *Save*, and everything a model wrote is on screen,
 * editable, when it is pressed.
 *
 * ***What it cannot show is by design.*** The carry arrives redacted — the goal
 * play would begin on only when a player may read it, and hooks as counts —
 * because the person making this is still playing the session it comes from,
 * and an unfired hook or a hidden goal is the one thing this surface must not
 * spoil. The Setup itself holds them in full; opening it in the library is an
 * authoring act, and a deliberate one.
 */
export function SetupFromTurn(props: {
  sessionId: string;
  turnId: string;
  busy: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        disabled={props.busy}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        Make a setup from here
      </Button>
      {open ? (
        <SetupWizard
          sessionId={props.sessionId}
          turnId={props.turnId}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * What a part that did not land says — the route sends a class, never prose.
 *
 * *`window-too-small` and `truncated` added at the merge* (2026-10-03), when
 * the server's draft learned them. A cut-off reply names both fixes, because
 * either works and only the person knows which they want: a shorter part asks
 * the same model for less, and a longer reply length lets it finish. The first
 * says what the failure catalogue's `window-too-small` says, *written out
 * rather than read from it*: `catalogue.test.ts` sweeps only tables of plain
 * literals, and one borrowed value would take this whole table out of its
 * sight.
 *
 * *The two `summary-` reasons since review the same day*: a link of the
 * session's summary chain that was cut off, or came back with nothing, fails
 * every part at once. The part's own sentences named the wrong reply and
 * offered a note, which reaches only the part it names and never the
 * summariser — so these say *a summary of the earlier story*, and the fix
 * that reaches it.
 */
const REFUSAL: Record<SetupPartRefusal, string> = labels('play.setup-part-refusal', {
  'role-unbound': 'No model is set up for writing. Choose one in Settings, then try again.',
  'role-dangling': 'The model for writing points at a connection that is gone.',
  'window-too-small':
    'The model’s context window is too small to hold the story beside its reply. Raise the context window in the connection’s settings, or lower the reply length.',
  'call-failed': 'The model did not answer. Try again.',
  truncated:
    'The draft ran past the reply length and was cut off, so it is not shown. Try again with a note asking for it shorter, or raise the reply length.',
  'no-answer': 'The model answered with nothing usable. Try again, perhaps with a note.',
  'summary-truncated':
    'A summary of the earlier story ran past the reply length and was cut off, so nothing was drafted from it. Raise the reply length, then try again.',
  'summary-no-answer':
    'The model wrote no usable summary of the earlier story, so nothing was drafted from it. Try again.',
});

/**
 * ***The sentence for a part that failed***, and for a provider failure the
 * remedy's — impersonation's rule (`impersonateLine`), since 2026-10-03, when
 * the route began sending one. *The model did not answer* was right for an
 * endpoint that was down and wrong for a wrong key or a busy one, and each has
 * its own fix. The generic line stays for a remedy this build has never heard
 * of, which `remedySentence` answers with nothing rather than a guess.
 */
function refusalOf(outcome: Extract<SetupPartOutcome<unknown>, { ok: false }>): string {
  if (outcome.reason === 'call-failed') {
    return remedySentence(outcome.remedy) ?? REFUSAL['call-failed'];
  }
  return REFUSAL[outcome.reason];
}

type PartState = { kind: 'idle' } | { kind: 'drafting' } | { kind: 'failed'; reason: string };

interface Fact {
  text: string;
  /** Comma-separated while it is being edited; split on save. */
  keys: string;
  kept: boolean;
}

function SetupWizard(props: {
  sessionId: string;
  turnId: string;
  onClose: () => void;
}): JSX.Element {
  const headingId = useId();
  const queryClient = useQueryClient();

  const [carry, setCarry] = useState<SetupCarryPreview | null>(null);
  const [warnings, setWarnings] = useState<SetupDraft['warnings']>([]);
  const [status, setStatus] = useState<Record<SetupPart, PartState>>({
    storySoFar: { kind: 'drafting' },
    opening: { kind: 'drafting' },
    title: { kind: 'drafting' },
    facts: { kind: 'drafting' },
  });

  const [storySoFar, setStorySoFar] = useState('');
  const [opening, setOpening] = useState('');
  const [openingFrom, setOpeningFrom] = useState<'scene' | 'verbatim'>('scene');
  const [name, setName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [facts, setFacts] = useState<Fact[]>([]);
  const [include, setInclude] = useState({ party: true, goals: true, hooks: true });
  const [notes, setNotes] = useState<Partial<Record<SetupPart, string>>>({});
  /** What a model wrote first, per path — the Setup's `generated` map. */
  const [originals, setOriginals] = useState<SetupFromTurnBody['generated']>({});

  const draft = useMutation({
    mutationFn: (parts: SetupPart[]) =>
      draftSetupFromTurn(props.sessionId, props.turnId, {
        parts,
        ...(openingFrom === 'verbatim' ? { openingFrom } : {}),
        guidance: Object.fromEntries(
          parts.flatMap((part) => {
            const note = notes[part]?.trim() ?? '';
            return note === '' ? [] : [[part, note]];
          }),
        ),
      }),
    onMutate: (parts) => {
      setStatus((was) => ({
        ...was,
        ...Object.fromEntries(parts.map((p) => [p, { kind: 'drafting' }])),
      }));
    },
    onSuccess: ({ draft: drafted }, parts) => {
      setCarry(drafted.carry);
      setWarnings(drafted.warnings);
      const next: Partial<Record<SetupPart, PartState>> = {};
      const wrote: NonNullable<SetupFromTurnBody['generated']> = {};

      for (const part of parts) {
        const outcome = drafted.parts[part];
        if (outcome === undefined) continue;
        if (!outcome.ok) {
          next[part] = { kind: 'failed', reason: refusalOf(outcome) };
          continue;
        }
        next[part] = { kind: 'idle' };
        switch (part) {
          case 'storySoFar': {
            const text = outcome.value as string;
            setStorySoFar(text);
            wrote.storySoFar = { original: text, model: outcome.model };
            break;
          }
          case 'opening': {
            const text = outcome.value as string;
            setOpening(text);
            // The narrator's own words are not a model's draft of this Setup.
            if (outcome.model !== null) {
              // The Setup's dotted path for its one written opening's text.
              wrote['openings.written.0.text'] = { original: text, model: outcome.model };
            }
            break;
          }
          case 'title': {
            const { name: named, blurb: blurbed } = outcome.value as {
              name: string;
              blurb: string;
            };
            setName(named);
            setBlurb(blurbed);
            wrote.name = { original: named, model: outcome.model };
            wrote.blurb = { original: blurbed, model: outcome.model };
            break;
          }
          case 'facts':
            setFacts(
              (outcome.value as { text: string; keys: string[] }[]).map((fact) => ({
                text: fact.text,
                keys: fact.keys.join(', '),
                kept: true,
              })),
            );
            break;
        }
      }
      setStatus((was) => ({ ...was, ...next }));
      setOriginals((was) => ({ ...was, ...wrote }));
    },
    onError: (error, parts) => {
      setStatus((was) => ({
        ...was,
        ...Object.fromEntries(parts.map((p) => [p, { kind: 'failed', reason: error.message }])),
      }));
    },
  });

  // Draft everything once, on open.
  const { mutate } = draft;
  useEffect(() => {
    mutate(['storySoFar', 'opening', 'title', 'facts']);
  }, [mutate]);

  const save = useMutation({
    mutationFn: () =>
      saveSetupFromTurn(props.sessionId, props.turnId, {
        texts: {
          name,
          blurb,
          storySoFar,
          opening: { label: openingFrom === 'verbatim' ? 'Where it left off' : '', text: opening },
        },
        include,
        facts: facts
          .filter((fact) => fact.kept)
          .map((fact) => ({
            text: fact.text,
            keys: fact.keys
              .split(',')
              .map((key) => key.trim())
              .filter((key) => key !== ''),
          })),
        ...(originals === undefined || Object.keys(originals).length === 0
          ? {}
          : { generated: originals }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });

  const regenerate = (part: SetupPart) => {
    draft.mutate([part]);
  };

  if (save.isSuccess) {
    const saved = save.data;
    return (
      <Dialog role="dialog" labelledBy={headingId} onDismiss={props.onClose} size="wide">
        <SectionTitle id={headingId}>{`Saved “${saved.setup.name}”`}</SectionTitle>
        <p className="text-sm">
          {saved.lorebook === null
            ? 'It is in your library as a setup. A session started from it begins where this one was.'
            : `It is in your library as a setup, with its facts in “${saved.lorebook.name}”. A session started from it begins where this one was.`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StartSession setupId={saved.setup.id} label="Start a session from it" />
          <Link
            to="/library/$kind/$id"
            params={{ kind: 'setups', id: saved.setup.id }}
            className={link.action}
          >
            Open it in the library
          </Link>
          <Button type="button" variant="quiet" onClick={props.onClose}>
            Back to the story
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog role="dialog" labelledBy={headingId} onDismiss={props.onClose} size="wide">
      <SectionTitle id={headingId}>Make a setup from here</SectionTitle>
      <Fine>
        Everything up to this point, condensed into somewhere to start from. Nothing is saved until
        you press Save, and everything below can be edited first.
      </Fine>

      <form
        className="mt-4 flex max-h-[70vh] flex-col gap-5 overflow-y-auto pe-1"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <section aria-label="What it carries" className="flex flex-col gap-2">
          <SubsectionTitle>What it carries</SubsectionTitle>
          {carry === null ? (
            <Fine>Reading the story at this point…</Fine>
          ) : (
            <Carried carry={carry} include={include} onInclude={setInclude} />
          )}
          {warnings.includes('no-summary-slot') ? (
            <Alert tone="warning">
              This session’s preset has no place for the story so far, so a session started with the
              same preset will not show it to the model. A preset with a summary slot will.
            </Alert>
          ) : null}
        </section>

        <PartSection
          title="The story so far"
          part="storySoFar"
          state={status.storySoFar}
          note={notes.storySoFar ?? ''}
          onNote={(next) => {
            setNotes((was) => ({ ...was, storySoFar: next }));
          }}
          onRegenerate={regenerate}
        >
          <Field
            label="What had already happened"
            value={storySoFar}
            onChange={setStorySoFar}
            multiline
            rows={8}
            hint="The model reads this at the start of every session made from the setup."
          />
        </PartSection>

        <PartSection
          title="Opening"
          part="opening"
          state={status.opening}
          note={notes.opening ?? ''}
          onNote={(next) => {
            setNotes((was) => ({ ...was, opening: next }));
          }}
          onRegenerate={regenerate}
        >
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">Where the opening comes from</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${headingId}-opening`}
                checked={openingFrom === 'scene'}
                onChange={() => {
                  setOpeningFrom('scene');
                }}
              />
              A new scene, written for someone arriving
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${headingId}-opening`}
                checked={openingFrom === 'verbatim'}
                onChange={() => {
                  setOpeningFrom('verbatim');
                }}
              />
              This turn’s own words
            </label>
          </fieldset>
          <Field
            label="The first thing the story says"
            value={opening}
            onChange={setOpening}
            multiline
            rows={6}
          />
        </PartSection>

        <PartSection
          title="Established facts"
          part="facts"
          state={status.facts}
          note={notes.facts ?? ''}
          onNote={(next) => {
            setNotes((was) => ({ ...was, facts: next }));
          }}
          onRegenerate={regenerate}
        >
          <Fine>Kept facts become a lorebook linked from the setup, each found by its keys.</Fine>
          {facts.length === 0 && status.facts.kind === 'idle' ? (
            <Fine>Nothing was found worth keeping.</Fine>
          ) : null}
          <ul className="flex flex-col gap-3" aria-label="Facts">
            {facts.map((fact, at) => (
              <li key={at} className="flex flex-col gap-1">
                <CheckboxField
                  label={`Keep fact ${String(at + 1)}`}
                  checked={fact.kept}
                  onChange={(kept) => {
                    setFacts((was) => was.map((one, i) => (i === at ? { ...one, kept } : one)));
                  }}
                />
                <Field
                  label={`Fact ${String(at + 1)}`}
                  value={fact.text}
                  onChange={(text) => {
                    setFacts((was) => was.map((one, i) => (i === at ? { ...one, text } : one)));
                  }}
                />
                <Field
                  label={`Keys for fact ${String(at + 1)}`}
                  value={fact.keys}
                  onChange={(keys) => {
                    setFacts((was) => was.map((one, i) => (i === at ? { ...one, keys } : one)));
                  }}
                  hint="Separated by commas. A fact with no keys is never found."
                />
              </li>
            ))}
          </ul>
        </PartSection>

        <PartSection
          title="Name and blurb"
          part="title"
          state={status.title}
          note={notes.title ?? ''}
          onNote={(next) => {
            setNotes((was) => ({ ...was, title: next }));
          }}
          onRegenerate={regenerate}
        >
          <Field label="Name" value={name} onChange={setName} required />
          <Field label="Blurb" value={blurb} onChange={setBlurb} multiline rows={2} />
        </PartSection>

        {save.isError ? (
          <Alert tone="error" role="alert">
            {save.error.message}
          </Alert>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={name.trim() === '' || save.isPending || draft.isPending}
          >
            Save as a setup
          </Button>
          <Button type="button" variant="quiet" onClick={props.onClose}>
            Cancel
          </Button>
          {name.trim() === '' && !draft.isPending ? <Fine>A setup needs a name.</Fine> : null}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * ***The carry, as far as it may be shown*** — names and counts, and three
 * switches. A group switched off is left out of the Setup, which is how a
 * person says *start fresh on this* without editing the Setup afterwards.
 */
function Carried(props: {
  carry: SetupCarryPreview;
  include: { party: boolean; goals: boolean; hooks: boolean };
  onInclude: (next: { party: boolean; goals: boolean; hooks: boolean }) => void;
}): JSX.Element {
  const { carry, include } = props;
  /**
   * The mode by the name the session form shows it by — the same query and the
   * same fallback, so a mode this build cannot name is shown by its id rather
   * than hidden.
   */
  const modes = useQuery({ queryKey: ['modes'], queryFn: listModes });
  const modeName =
    modes.data?.modes.find((one) => one.id === carry.mode)?.displayName ?? carry.mode;
  const set = (key: 'party' | 'goals' | 'hooks') => (checked: boolean) => {
    props.onInclude({ ...include, [key]: checked });
  };

  const current = carry.goals.current;
  const goalLine =
    carry.goals.carried === 'concluded'
      ? 'The story had ended here, so no goal carries.'
      : carry.goals.carried === 'open'
        ? 'The story was on no goal here, by choice, so none carries.'
        : carry.goals.carried === 'none'
          ? 'No goals.'
          : current !== null && 'statement' in current
            ? `Begins on: ${current.statement}`
            : 'Begins on a goal that is hidden from you.';

  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Mode</dt>
        <dd>{modeName === '' ? carry.mode : modeName}</dd>
        <dt className="text-ink-muted">Treatment</dt>
        <dd>{carry.treatment ?? 'None'}</dd>
        <dt className="text-ink-muted">Preset</dt>
        <dd>{carry.preset ?? 'The mode’s own'}</dd>
        <dt className="text-ink-muted">Persona</dt>
        <dd>{carry.persona ?? 'Nobody in particular'}</dd>
        <dt className="text-ink-muted">Lorebooks</dt>
        <dd>{carry.lore.length === 0 ? 'None' : carry.lore.join(', ')}</dd>
      </dl>
      <CheckboxField
        label={
          carry.party.length === 0
            ? 'The party (nobody but you)'
            : `The party: ${carry.party.join(', ')}`
        }
        checked={include.party}
        onChange={set('party')}
      />
      <CheckboxField
        label={`Goals — ${goalLine}`}
        checked={include.goals}
        onChange={set('goals')}
        {...(carry.goals.count > 1
          ? { hint: `${String(carry.goals.count - 1)} more after it.` }
          : {})}
      />
      <CheckboxField
        label={
          carry.hooks.carried === 0 && carry.hooks.spent === 0
            ? 'Plot hooks — none'
            : `Plot hooks — ${String(carry.hooks.carried)} still waiting, ${String(carry.hooks.spent)} already used`
        }
        checked={include.hooks}
        onChange={set('hooks')}
        hint="Used ones are marked spent so they do not happen twice. What they are is not shown here."
      />
    </div>
  );
}

function PartSection(props: {
  title: string;
  part: SetupPart;
  state: PartState;
  note: string;
  onNote: (next: string) => void;
  onRegenerate: (part: SetupPart) => void;
  children: React.ReactNode;
}): JSX.Element {
  const drafting = props.state.kind === 'drafting';
  return (
    <section aria-label={props.title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SubsectionTitle>{props.title}</SubsectionTitle>
        {drafting ? (
          <span role="status" className="text-sm text-ink-muted">
            Drafting…
          </span>
        ) : null}
      </div>
      {props.state.kind === 'failed' ? (
        <Alert tone="error" role="alert">
          {props.state.reason}
        </Alert>
      ) : null}
      {props.children}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field
            label={`A note for the next draft of ${props.title.toLowerCase()}`}
            value={props.note}
            onChange={props.onNote}
            placeholder="Optional — shorter, darker, leave out the weather…"
          />
        </div>
        <Button
          type="button"
          size="compact"
          disabled={drafting}
          onClick={() => {
            props.onRegenerate(props.part);
          }}
        >
          {props.state.kind === 'failed' ? `Try ${props.title.toLowerCase()} again` : 'Regenerate'}
        </Button>
      </div>
    </section>
  );
}
