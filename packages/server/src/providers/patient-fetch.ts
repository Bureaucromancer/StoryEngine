// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Agent, fetch as undiciFetch } from 'undici';

/**
 * ***A fetch with no clock of its own*** (2026-09-27) — so that
 * `limits.providerTimeoutMs` is the only one a provider call runs under.
 *
 * Node's global `fetch` is undici's, and undici's default dispatcher gives up
 * on a response whose headers have not arrived in 300 seconds, and on a body
 * that falls quiet for 300 more. Every provider call went through it,
 * underneath `performCall`'s own bound. So a slow local model — a large one
 * loading, or reading a long prompt on a small machine — could not be given
 * more than five minutes to start answering however the operator set
 * `providerTimeoutMs`, and `0`, which [22 §4] says switches the bound off,
 * switched off only ours. And the error reads *Headers Timeout Error*, which
 * the adapter's classifier took for a connection that did not work: the ladder
 * asked twice more, a quarter of an hour of waiting for one refusal.
 *
 * This dispatcher has neither limit, and the bound that stays is [22 §4]'s:
 * `withIdleTimeout`, per attempt, on **silence** rather than duration, and off
 * at zero. Connecting still has undici's own timeout, which is a different
 * question — whether the endpoint is there at all — and is right to answer
 * quickly.
 *
 * *undici's own `fetch` rather than the global one with this dispatcher*: the
 * global one is Node's bundled copy of undici, and a dispatcher from a
 * different copy is not guaranteed to fit it. This is the same package the
 * AI SDK already brings, pinned to the same version.
 */
export const PATIENT_DISPATCH = { headersTimeout: 0, bodyTimeout: 0 } as const;

const PATIENT = new Agent(PATIENT_DISPATCH);

export const patientFetch: typeof globalThis.fetch = (input, init) =>
  undiciFetch(input, { ...init, dispatcher: PATIENT });
