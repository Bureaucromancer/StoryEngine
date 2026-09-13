// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { missMessage, needsPrompting, schemaInstruction, schemaMiss } from './structured.js';

/**
 * Asking for a shape, and checking you got one — [P7.4].
 *
 * **The validation half exists because the SDK's does not.** Measured at P7.4
 * and pinned in `openai-compatible.test.ts`: `jsonSchema()` puts the document on
 * the wire and nothing on this side checks the reply against it, so
 * `{"nom":"Vera"}` comes back as a successful object against a schema requiring
 * `name`. Everything here is the engine doing the job nobody else does.
 */

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer' } },
  required: ['name'],
  additionalProperties: false,
};

describe('deciding whether to ask in words', () => {
  it('does when the endpoint cannot be handed a schema', () => {
    expect(needsPrompting(SCHEMA, false)).toBe(true);
  });

  it('does not when it can, because the wire already said it', () => {
    // A caller that degraded unconditionally would spend tokens on every
    // request to an endpoint that did not need them.
    expect(needsPrompting(SCHEMA, false)).toBe(true);
    expect(needsPrompting(SCHEMA, true)).toBe(false);
  });

  it('does not when nobody asked for a shape', () => {
    expect(needsPrompting(undefined, false)).toBe(false);
    expect(needsPrompting(undefined, true)).toBe(false);
  });
});

describe('the instruction a degraded call carries', () => {
  it('names the schema it is standing in for', () => {
    const candidate = schemaInstruction(SCHEMA);

    expect(candidate.text).toContain(JSON.stringify(SCHEMA));
  });

  /**
   * **Required, so the budgeter never drops it.** A call that must answer in a
   * shape is meaningless without the sentence saying which shape — which is
   * exactly what `Candidate.required` is for.
   */
  it('is required and is not advisory', () => {
    const candidate = schemaInstruction(SCHEMA);

    expect(candidate.required).toBe(true);
    // [06 §5.2] refuses advisory content on a call that produces effects, and
    // every call that wants a schema is such a call — so marking this advisory
    // would make it undeliverable on the only calls it exists for.
    expect(candidate.advisory).toBeUndefined();
  });

  it('carries a source the record can account for', () => {
    // `RenderedMessage.fromBlocks` is non-empty always, so a prompt the block
    // table cannot explain is not an option.
    expect(schemaInstruction(SCHEMA).source).toEqual({ kind: 'schema' });
  });

  it('says why it is there in words a reader did not write', () => {
    // `reason` is what the workbench shows. A block whose reason read "schema"
    // would be a debug string.
    expect(schemaInstruction(SCHEMA).reason).toMatch(/cannot be sent a schema/);
  });
});

describe('whether the answer fits', () => {
  it('passes an object that matches', () => {
    expect(schemaMiss(SCHEMA, { name: 'Vera' })).toBeNull();
    expect(schemaMiss(SCHEMA, { name: 'Vera', age: 41 })).toBeNull();
  });

  /**
   * **The measured case.** This is the exact value the SDK accepted, and the
   * reason this module exists.
   */
  it('catches the one the SDK let through', () => {
    const miss = schemaMiss(SCHEMA, { nom: 'Vera' });

    expect(miss?.reason).toBe('invalid');
    expect(miss?.issues.length).toBeGreaterThan(0);
  });

  it('catches a field of the wrong type', () => {
    expect(schemaMiss(SCHEMA, { name: 'Vera', age: 'forty-one' })?.reason).toBe('invalid');
  });

  /**
   * `undefined` is *the reply would not parse*, never *nothing came back*: the
   * adapter leaves the key undefined only when a schema was asked for, and a
   * call nobody asked a shape of carries no key at all.
   */
  it('reads an absent object as unparseable', () => {
    const miss = schemaMiss(SCHEMA, undefined);

    expect(miss?.reason).toBe('unparseable');
    expect(miss?.issues).toEqual([]);
  });

  it('passes anything when nobody asked for a shape', () => {
    expect(schemaMiss(undefined, undefined)).toBeNull();
    expect(schemaMiss(undefined, { anything: true })).toBeNull();
  });

  /**
   * **A schema that will not compile is a pass**, which is the same call
   * `channel-schema.ts` makes: a broken declaration is a mode author's mistake,
   * and failing every call over it takes the mode out of service for something
   * nobody playing can fix ([00 §3.3]).
   */
  it('passes when the schema itself is the broken thing', () => {
    expect(schemaMiss({ type: 'not-a-type' }, { anything: true })).toBeNull();
  });

  it('compiles a schema once and keeps answering', () => {
    // Keyed on the object, like `channel-schema.ts` — so the same declaration
    // handed over on every turn is compiled once, and an edited one is not
    // served a stale validator.
    expect(schemaMiss(SCHEMA, { name: 'Vera' })).toBeNull();
    expect(schemaMiss(SCHEMA, { nom: 'Vera' })?.reason).toBe('invalid');
    expect(schemaMiss(SCHEMA, { name: 'Vera' })).toBeNull();
  });
});

describe('what a miss reads as in the record', () => {
  it('says the model did not answer with JSON at all', () => {
    expect(missMessage({ reason: 'unparseable', issues: [] })).toMatch(/did not answer with JSON/);
  });

  /**
   * The issues travel because they are the only thing separating *nearly right*
   * from *nothing like it* — which is the difference between raising the budget
   * and rewriting the step.
   */
  it('carries the issues for a shape that was nearly right', () => {
    const message = missMessage({
      reason: 'invalid',
      issues: ["/ must have required property 'name'"],
    });

    expect(message).toContain('required');
  });
});
