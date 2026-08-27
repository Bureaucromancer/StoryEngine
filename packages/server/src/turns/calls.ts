// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type GenerationParams, uuidv7 } from '@storyengine/shared';

import { assemble } from '../assembly/assemble.js';
import { render } from '../assembly/render.js';
import type {
  AssembledBlock,
  BudgetVerdict,
  CallPurpose,
  Candidate,
  NotFilledSlot,
} from '../assembly/types.js';
import type { Config } from '../config.js';
import type { Connection } from '../providers/connections.js';
import type { ProviderFactory } from '../providers/factory.js';
import { resolveRole, type RoleBindings } from '../providers/roles.js';
import {
  ProviderError,
  type FinishReason,
  type GenerationResult,
  type ModelRole,
  type RenderedMessage,
  type TokenUsage,
} from '../providers/types.js';
import type { ModelCall } from '../sessions/types.js';
import { budgetPolicyFor, type PresetBudget } from './budget.js';
import { callPurposeFor, type StepCallRequest, type StepDefinition } from './steps.js';

/**
 * One model call, and the record of it — [13 §1.4].
 *
 * Everything a call needs to become a `ModelCall` happens here: resolving the
 * role, budgeting against the endpoint that answered, assembling, rendering,
 * calling, retrying, and writing down what happened. The runner supplies
 * context and receives one result and one record.
 */

/** A step asked for a model it has no binding for. Not an exception out of the job. */
export class RoleUnresolved extends Error {
  readonly reason: 'unbound' | 'dangling';

  constructor(role: string, reason: 'unbound' | 'dangling') {
    super(
      reason === 'unbound'
        ? `Nothing is bound to the ${role} role.`
        : `The ${role} role points at a connection that is gone.`,
    );
    this.name = 'RoleUnresolved';
    this.reason = reason;
  }
}

/**
 * The turn was stopped. Distinct from a provider failure, and never retried.
 *
 * **Carries the interrupted call when there was one** — finding 2 in
 * [16](../../../../docs/design/workplan/16-p2c-log.md). Stop is the
 * most-pressed button in a manual phase against real latency, and until this
 * carried a record, the failure a tester produced most often was the one the
 * record said least about: `request.calls: []`, no connection id, no model, no
 * wall time. `CallFailed` had carried all of that since the day it was
 * written; a cancellation lost it only because this class was thrown one line
 * earlier. Both stay optional: a Stop that lands *between* attempts has
 * genuinely no call to name.
 */
export class Cancelled extends Error {
  readonly call?: ModelCall;
  readonly partialText?: string;

  constructor(interrupted?: { call: ModelCall; partialText: string }) {
    super('The turn was cancelled.');
    this.name = 'Cancelled';
    if (interrupted !== undefined) {
      this.call = interrupted.call;
      this.partialText = interrupted.partialText;
    }
  }
}

/**
 * Everything a call is, the moment it exists and before it is dispatched —
 * [P3.0]. The runner checkpoints a provisional in-flight `ModelCall` from
 * this, which is what lets a turn killed mid-call keep its block table now
 * that blocks live on the call: the assembly must be durable before the
 * provider is asked, or a power cut erases the prompt the record's own
 * docstring promises to keep.
 */
export interface ProvisionalCall {
  id: string;
  stepId: string;
  role: ModelRole;
  purpose: CallPurpose;
  /** The model that will be *asked* — the success record replaces this with the one that answered. */
  resolved: { connectionId: string; modelId: string };
  blocks: AssembledBlock[];
  budget: BudgetVerdict;
  notFilled: NotFilledSlot[];
  messages: RenderedMessage[];
  params: GenerationParams;
  startedAt: number;
}

export interface CallContext {
  definition: StepDefinition;
  bindings: RoleBindings;
  /** The install defaults this account's bindings fall back to ([P2B §2.1]). */
  defaults?: RoleBindings;
  usable: Connection[];
  providers: ProviderFactory;
  config: Config;
  /**
   * The session's prompt pack — its generation defaults and its budget policy.
   *
   * Both were written into every shipped preset and read by nothing: a preset
   * declaring `temperature: 0.85` and `maxTokens: 800` reached the provider as
   * `{}`, and its `contextShare` never narrowed anything.
   */
  preset?: { params: GenerationParams; budget: PresetBudget };
  signal: AbortSignal;
  /** What the preset's collection left unfilled, for the record ([P3.0] §7.5). */
  notFilled: readonly NotFilledSlot[];
  /** The call as assembled and rendered, before dispatch — see {@link ProvisionalCall}. */
  onCallAssembled(provisional: ProvisionalCall): void;
  /** A durable, coalesced checkpoint. The runner decides how often. */
  onProgress(event: { kind: 'started'; model: string } | { kind: 'streaming'; text: string }): void;
}

export interface CallOutcome {
  text: string;
  object: unknown;
  usage: TokenUsage | null;
  call: ModelCall;
}

/**
 * Fixed backoff, no jitter — and the absence is deliberate.
 *
 * The randomness rule bans `Math.random` and `node:crypto` outside `rng/`, and
 * drawing backoff through `rng.at()` would put a scheduling artefact on the
 * replay tape. The tape is for draws that affect *outcome*
 * ([07 §14.6](../../../../docs/design/07-tech-stack.md)); a sleep is not one. A named
 * constant follows `MINUTES_PER_TURN`'s precedent and costs no config key.
 */
const RETRY_BACKOFF_MS = [250, 1000] as const;

/**
 * A call abandoned because **nothing happened for too long** — [P2C §1.3].
 *
 * Distinct from `Cancelled` and it has to be: a person pressing Stop and an
 * endpoint that stopped answering produce the same `AbortError` from the same
 * signal, and telling a user *you cancelled this* when they did not is worse
 * than the hang. The reason is carried out of band, on the composed controller,
 * rather than read back off an exception nobody can attribute.
 *
 * Classified `terminal`, deliberately. It is transient in the ordinary sense —
 * try again in a minute and it may well answer — but the point of the key is
 * that a hang has an exit, and two retries at the full timeout each is three
 * times as long a hang. A person who wants another attempt has a Retry button;
 * a person waiting on a wedged turn has nothing.
 */
class Stalled extends ProviderError {
  constructor(ms: number) {
    super('terminal', `The endpoint sent nothing for ${String(ms)}ms.`);
    this.name = 'Stalled';
  }
}

/**
 * The signal one attempt runs under: the caller's, plus an idle timer.
 *
 * The timer is armed at the start and re-armed by every streamed chunk, so what
 * it bounds is silence rather than length. `dispose` is not optional — a
 * pending `setTimeout` keeps the event loop alive, and a suite that leaves one
 * per call hangs on exit rather than failing.
 */
function noop(): void {
  /* Nothing to arm and nothing to clear. */
}

function withIdleTimeout(
  outer: AbortSignal,
  ms: number,
): { signal: AbortSignal; progress: () => void; stalled: () => boolean; dispose: () => void } {
  if (ms <= 0) {
    // Switched off: the caller's own signal, unwrapped. Not a controller that
    // never fires — `AbortSignal.any` allocates and subscribes, and this is the
    // configuration somebody chose because their endpoint is slow.
    return { signal: outer, progress: noop, stalled: () => false, dispose: noop };
  }

  const controller = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      controller.abort();
    }, ms);
    // Node keeps the process alive for a pending timer, and this one outlives
    // nothing worth waiting for.
    timer.unref();
  };
  arm();

  return {
    signal: AbortSignal.any([outer, controller.signal]),
    progress: arm,
    stalled: () => fired,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export async function performCall(
  context: CallContext,
  request: StepCallRequest,
  candidates: readonly Candidate[],
): Promise<CallOutcome> {
  const { definition } = context;
  if (definition.role === null) {
    throw new Error(`Step ${definition.id} made a call but declares no role.`);
  }

  // **Narrowed, never destructured.** `resolveRole` distinguishes `unbound`
  // from `dangling` because the remedies differ — the first is setup, the second
  // is an admin having removed a connection out from under a binding — and
  // flattening them loses the UI's ability to offer the right one.
  const resolution = resolveRole({
    role: definition.role,
    bindings: context.bindings,
    ...(context.defaults === undefined ? {} : { defaults: context.defaults }),
    usable: context.usable,
  });
  if (!resolution.ok) throw new RoleUnresolved(definition.role, resolution.reason);

  const provider = context.providers(resolution.connection);
  // A step's own request wins over the preset's defaults, and the preset's win
  // over nothing — which is the layering [10 §8] describes for everything else.
  const params: GenerationParams = { ...context.preset?.params, ...request.params };
  const policy = budgetPolicyFor(
    provider.capabilities,
    params,
    context.config,
    context.preset?.budget,
  );

  // **The purpose comes from the definition, not from the request.** A step
  // that could name its own would be one honest declaration away from walking
  // an advisory block into an effect-producing call ([03 §5.2]). Computed
  // once, because it is also stamped on every record this call can leave
  // ([P3.0] — the invariant's committed half).
  const purpose = callPurposeFor(definition);
  const assembled = assemble({
    candidates: request.candidates ?? candidates,
    policy,
    purpose,
  });
  // A step that supplied its own candidates never consulted the preset, so
  // the not-filled list honestly empties rather than describing a collection
  // this call did not use ([P3.0] §7.5).
  const notFilled = request.candidates === undefined ? [...context.notFilled] : [];

  // Never pre-folded: `systemMessage: 'fold-into-first-user'` is honoured inside
  // the adapter, and folding above it would corrupt the record's block table.
  const messages = render(assembled.blocks, { capabilities: provider.capabilities });

  const id = uuidv7();
  const startedAt = Date.now();
  // The call exists from here — id, blocks, verdict, rendered messages — and
  // the runner checkpoints it before anything is dispatched ([P3.0]): every
  // exit below replaces the provisional by this same id, so only a process
  // that died mid-call ever commits it.
  context.onCallAssembled({
    id,
    stepId: definition.id,
    role: definition.role,
    purpose,
    resolved: { connectionId: resolution.connection.id, modelId: resolution.modelId },
    blocks: assembled.blocks,
    budget: assembled.verdict,
    notFilled,
    messages,
    params,
    startedAt,
  });

  context.onProgress({ kind: 'started', model: resolution.modelId });

  let retries = 0;

  for (;;) {
    if (stopped(context.signal)) throw new Cancelled();

    // A holder rather than two `let`s: both are assigned from inside the
    // stream callback, and the type checker cannot follow a closure — so a bare
    // `let` stays narrowed to its initialiser and the retry guard below reads
    // as dead code.
    const partial = { streamed: false, text: '' };
    // Per attempt, not per call: a retry that inherited a spent timer would be
    // aborted before it asked anything.
    const bound = withIdleTimeout(context.signal, context.config.limits.providerTimeoutMs);
    try {
      const result = await invoke(
        provider,
        {
          modelId: resolution.modelId,
          messages,
          params,
          ...(request.schema === undefined ? {} : { schema: request.schema }),
          signal: bound.signal,
        },
        request.stream === true,
        (text) => {
          bound.progress();
          partial.streamed = true;
          partial.text += text;
          context.onProgress({ kind: 'streaming', text });
        },
      );

      return {
        text: result.text,
        object: result.object,
        usage: result.usage,
        call: {
          id,
          stepId: definition.id,
          role: definition.role,
          purpose,
          // The id and the model, never the connection: it carries `apiKey` and
          // `baseUrl`, and this record is a line in a file on somebody's disk.
          resolved: { connectionId: resolution.connection.id, modelId: result.modelId },
          blocks: assembled.blocks,
          budget: assembled.verdict,
          notFilled,
          messages,
          params,
          usage: result.usage,
          cost: result.cost,
          wallMs: Date.now() - startedAt,
          finishReason: result.finishReason,
          /**
           * **Not every returned call is a clean answer.** A ceiling reached
           * and a stream that stopped without saying both come back looking
           * like success — no error, just less text — and recording them as
           * `ok` is what made a truncated reply indistinguishable from a
           * finished one.
           */
          outcome: outcomeOf(result.finishReason),
          error: null,
          retries,
        },
      };
    } catch (thrown: unknown) {
      let error = thrown;
      // Checked again, because the abort can land *during* the call — which is
      // the ordinary case for a user pressing Stop. Read through a function
      // rather than directly: `aborted` is a getter whose value changes across
      // an await, and the type checker narrows it to the value it had at the
      // top of the loop and then calls this line dead.
      //
      // An attempt was in flight, so the cancellation names it: the model that
      // was *asked*, because nothing answered — the same distinction the
      // failure record below draws. `usage` and `finishReason` stay null
      // rather than invented, and `error` stays null because nothing failed.
      if (stopped(context.signal)) {
        throw new Cancelled({
          call: {
            id,
            stepId: definition.id,
            role: definition.role,
            purpose,
            resolved: { connectionId: resolution.connection.id, modelId: resolution.modelId },
            blocks: assembled.blocks,
            budget: assembled.verdict,
            notFilled,
            messages,
            params,
            usage: null,
            cost: null,
            wallMs: Date.now() - startedAt,
            finishReason: null,
            outcome: 'cancelled',
            error: null,
            retries,
          },
          partialText: partial.text,
        });
      }
      // **After the caller's signal and before everything else.** Both aborts
      // arrive as the same `AbortError`, so the order is the attribution: the
      // person wins, and only silence that nobody asked to end is a stall. The
      // adapter's classifier matches `/abort/i` and would otherwise have called
      // this `transient` and retried the hang twice.
      if (bound.stalled()) {
        error = new Stalled(context.config.limits.providerTimeoutMs);
      }

      const classified = classify(error);
      const attempt = RETRY_BACKOFF_MS[retries];

      /**
       * Retry only when all three hold.
       *
       * The middle one is not obvious and is the whole of a bug avoided: the
       * adapter classifies an aborted request as `transient` (its classifier
       * matches `/abort/i`), so without the abort check a user's Stop button
       * would be answered by trying again.
       *
       * The third is the one that costs prose. Re-streaming after a partial
       * answer duplicates text in both the record and the client's view, and
       * neither adapter hands back what it accumulated — the runner's buffer is
       * the only survivor, and it survives as a *failure*, not as an attempt to
       * repeat.
       */
      const retryable =
        error instanceof ProviderError &&
        (error.class === 'retryable' || error.class === 'transient');
      if (retryable && attempt !== undefined && !partial.streamed) {
        retries += 1;
        await new Promise((tick) => setTimeout(tick, attempt));
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      const detail = error instanceof ProviderError ? error.detail : undefined;
      throw new CallFailed(
        classified,
        message,
        partial.text,
        {
          id,
          stepId: definition.id,
          role: definition.role,
          purpose,
          // The model that was *asked for*, because nothing answered — and said
          // so here rather than left to read like a report, which is the same
          // distinction `modelThatAnswered` draws on the success path.
          resolved: { connectionId: resolution.connection.id, modelId: resolution.modelId },
          blocks: assembled.blocks,
          budget: assembled.verdict,
          notFilled,
          messages,
          params,
          usage: null,
          cost: null,
          wallMs: Date.now() - startedAt,
          finishReason: null,
          outcome: 'error',
          error: { class: classified, message },
          retries,
        },
        detail,
      );
    } finally {
      // Every exit, including the returned success — a live timer holds a
      // reference to a controller for a call that is over.
      bound.dispose();
    }
  }
}

/**
 * A call that failed, carrying what it had managed to produce.
 *
 * The partial text is the point. A mid-stream failure has already handed the
 * user words, and P2's gate wants those words on the record rather than a turn
 * that reads as though nothing happened.
 */
export class CallFailed extends Error {
  readonly class: ProviderError['class'];
  /**
   * The provider's own words, carried rather than dropped — F32.
   *
   * `message` is this system's sentence about the failure; `detail` is the
   * endpoint's, which is where a provider actually explains itself
   * (*"Incorrect API key provided"* rather than *"Bad Request"*). It was
   * classified and then thrown away here, so the one thing that would have told
   * an operator what to change never left the adapter.
   *
   * For the log only, never rendered as UI copy — same terms as
   * {@link ProviderError.detail}, which [07 §12.7] keeps untranslated.
   */
  readonly detail: string | undefined;
  readonly partialText: string;
  readonly call: ModelCall;

  constructor(
    errorClass: ProviderError['class'],
    message: string,
    partialText: string,
    call: ModelCall,
    detail?: string,
  ) {
    super(message);
    this.name = 'CallFailed';
    this.class = errorClass;
    this.detail = detail;
    this.partialText = partialText;
    this.call = call;
  }
}

/** Reads the signal now, past the narrowing described above. */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

function classify(error: unknown): ProviderError['class'] {
  return error instanceof ProviderError ? error.class : 'terminal';
}

/**
 * Streams or generates, gated on the **capability** rather than on the method.
 *
 * `typeof provider.stream === 'function'` would be feature detection, and
 * `FakeProvider.stream` is an ordinary class method — so a provider declaring it
 * cannot stream would stream anyway, and the double would never catch it.
 */
async function invoke(
  provider: ReturnType<ProviderFactory>,
  request: Parameters<ReturnType<ProviderFactory>['generate']>[0],
  wantStream: boolean,
  onChunk: (text: string) => void,
): Promise<GenerationResult> {
  if (!wantStream || !provider.capabilities.supportsStreaming || provider.stream === undefined) {
    return provider.generate(request);
  }

  const stream = provider.stream(request);
  let next = await stream.next();
  while (next.done !== true) {
    onChunk(next.value.text);
    next = await stream.next();
  }
  return next.value;
}

/**
 * A finish reason as a call outcome.
 *
 * The mapping is the whole point of recording the reason: `stop` and a tool
 * call are answers, a ceiling is a truncation, a filter is a refusal, and a
 * stream that ended without saying is incomplete. Four states where there used
 * to be one, and three of them used to be `ok`.
 */
function outcomeOf(reason: FinishReason): ModelCall['outcome'] {
  switch (reason) {
    case 'stop':
    case 'tool':
      return 'ok';
    case 'length':
      return 'truncated';
    case 'filtered':
      return 'refused';
    case 'unknown':
      return 'incomplete';
  }
}
