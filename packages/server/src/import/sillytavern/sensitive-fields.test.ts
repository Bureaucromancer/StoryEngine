// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { SILLYTAVERN_SENSITIVE_FIELDS, stripSensitiveFields } from './sensitive-fields.js';

/**
 * The vendored snapshot, checked against the fields
 * [10 §8.4.4](../../../../../docs/design/10-schemas.md) names.
 *
 * §1.1 asked for the list to be *"derived from that category rather than
 * enumerated by hand"*, and this is the half of that promise a test can keep: if
 * the snapshot is ever re-taken and loses a field the design document names by
 * name, the build says so.
 */

/** Every field §8.4.4 names in its own prose. */
const NAMED_BY_THE_DESIGN = [
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_headers',
  'azure_base_url',
  'azure_deployment_name',
  'vertexai_express_project_id',
];

describe('the vendored sensitive-field list', () => {
  it('covers every field the design names', () => {
    for (const field of NAMED_BY_THE_DESIGN) {
      expect(SILLYTAVERN_SENSITIVE_FIELDS, `${field} is missing`).toContain(field);
    }
  });

  it('is a superset of them, because the source is the authority and not the prose', () => {
    // The point of vendoring their category rather than our paragraph: fields
    // they added that no document of ours has ever named still get dropped.
    expect(SILLYTAVERN_SENSITIVE_FIELDS.length).toBeGreaterThan(NAMED_BY_THE_DESIGN.length);
  });
});

describe('stripping them', () => {
  it('removes the field and reports the name, never the value', () => {
    const { kept, removed } = stripSensitiveFields({
      proxy_password: 'hunter2',
      temperature: 0.9,
    });

    expect(kept).toEqual({ temperature: 0.9 });
    expect(removed).toEqual(['proxy_password']);
    // A value read out in order to be reported is a value that reaches a log.
    expect(JSON.stringify(removed)).not.toContain('hunter2');
  });

  it('does not report a field that was present and empty', () => {
    // ST writes these keys into every preset. Reporting eleven removals on a
    // file that carried no credential would train people to ignore the message
    // — and then to ignore it on the file that did.
    const { kept, removed } = stripSensitiveFields({
      reverse_proxy: '',
      custom_url: null,
      azure_base_url: undefined,
      temperature: 0.9,
    });

    expect(removed).toEqual([]);
    // Still removed from the object, though: empty or not, there is nowhere to
    // put them and no reason to carry them.
    expect(kept).toEqual({ temperature: 0.9 });
  });
});
