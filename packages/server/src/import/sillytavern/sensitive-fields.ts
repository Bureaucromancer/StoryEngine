// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * SillyTavern's own list of preset fields that carry a connection or a
 * credential, vendored ([04 §8.4.4](../../../../../docs/design/04-schemas.md),
 * [P4 §1.1](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * Snapshot provenance:
 *   source  SillyTavern/public/scripts/openai.js, `sensitiveFields`
 *   commit  06bde939fb1e9c4c8d8641d810f0a916b5bce127 (1.19.0, 2026-09-14)
 *   taken   2026-09-22
 *   was     8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8 (1.18.0+1, 2026-07-07),
 *           byte-identical
 *
 * **Derived from their category rather than enumerated by hand**, which is what
 * §1.1 asked for: the list is theirs, so a field they add is one we can notice
 * missing rather than one we never thought of. Vendored rather than fetched,
 * because a build that needs another repository checked out is a build that
 * fails on somebody else's machine.
 *
 * **The rule is not a prompt.** ST detects these on import and export and offers
 * to remove them — with *"Import as-is"* among the options, and the default
 * being a choice rather than a removal, which is why presets circulating in the
 * wild can and do contain a working proxy password. Ours drops every one of them
 * unconditionally and says which were present.
 *
 * Three reasons it is unconditional, from §8.4.4, and the third is the one that
 * settles it: there is nowhere to put them, so this is the type refusing rather
 * than a check that could be forgotten; **the person importing is not the person
 * at risk**, since a leaked proxy password harms whoever published the preset;
 * and it is reported rather than merely dropped, because a circulating file
 * containing someone's credential is worth somebody knowing about.
 *
 * This is also the one class of source field that never lands in `compat`. Every
 * other unrecognised field is preserved verbatim under [04 §2]'s preservation
 * rule; these are the named exception, and preserving them would defeat the
 * entire point of removing them.
 */
export const SILLYTAVERN_SENSITIVE_FIELDS = [
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_body',
  'custom_exclude_body',
  'custom_include_headers',
  'vertexai_region',
  'vertexai_express_project_id',
  'azure_base_url',
  'azure_deployment_name',
  'workers_ai_account_id',
] as const;

const SENSITIVE = new Set<string>(SILLYTAVERN_SENSITIVE_FIELDS);

/**
 * Splits a preset body into what may be kept and what must never be.
 *
 * Returns the removed field *names*, never their values — the review says which
 * fields were present, and a value that has been read out to be reported is a
 * value that can end up in a log.
 */
export function stripSensitiveFields(body: Readonly<Record<string, unknown>>): {
  kept: Record<string, unknown>;
  removed: string[];
} {
  const kept: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    // Present-and-empty is not present: ST writes these keys into every preset,
    // and reporting eleven removals on a file that carried no credential at all
    // would train people to ignore the message.
    if (SENSITIVE.has(key)) {
      if (value !== undefined && value !== null && value !== '') removed.push(key);
      continue;
    }
    kept[key] = value;
  }

  return { kept, removed };
}
