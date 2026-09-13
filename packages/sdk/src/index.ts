// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The published extension and mode contract.
 *
 * ~~Scaffolded at P1.0: it re-exports `shared` and nothing else.~~ **Scaffolded
 * at P1.0 and given its contract at [P7.0]** (docs/design/workplan/23-p7-implementation.md).
 * The package predated the contract on purpose: the boundary rule that makes
 * built-in modes consume this package — rather than reaching into `server` —
 * had to predate the first mode (docs/design/19-tech-stack.md §10), and a rule
 * whose subject arrives later is still a rule.
 *
 * **What is here is what a step author writes against, and nothing that
 * decides.** The condition evaluator, the payload filter, the purpose
 * derivation and the runner all stay in the engine; a mode declares and the
 * engine enforces, which is the whole of docs/design/06-modes-and-turn-pipeline.md §2.
 * If something a mode needs is missing from these exports, that is the contract
 * being wrong — the standing instruction is to fix it here rather than to reach
 * past it.
 *
 * **`shared` is re-exported and not re-declared.** The portable schemas and the
 * record's shapes are the same types on both sides of this boundary; a second
 * declaration would be two vocabularies for one wire format, which is the
 * failure that document spends §2 preventing.
 */

export * from '@storyengine/shared';

export type { ChannelDefinition, InitPolicy, WidgetSpec } from './channels.js';
export {
  DIAL_CHANNELS,
  dialChannel,
  SE_DIFFICULTY,
  SE_DIRECTEDNESS,
  type DialAxis,
} from './dials.js';
export { MEDIA_SELECTION_SCHEMA, type MediaSelection } from './media.js';
export { PARTICIPANT_SELECTORS, setupAnswerSchema } from './mode.js';
export type {
  AssemblyPlan,
  DeclaredSetup,
  FieldWidget,
  Mode,
  ModeDefinition,
  ModePreset,
  NoSetup,
  ParticipantPolicy,
  SetupField,
  SetupSchema,
  SurfaceContribution,
} from './mode.js';
export type { RandomApi, SiteRandom } from './random.js';
export type {
  Candidate,
  CastEntry,
  EffectProposal,
  StepCallRequest,
  StepCallResult,
  StepCondition,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
  StepResult,
} from './steps.js';
