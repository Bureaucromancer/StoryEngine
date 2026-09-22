// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * SillyTavern's own vocabularies, vendored
 * ([P4 §7.19](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The same mechanism §1.8 already decided for the directory template, applied
 * to what is *inside* the files.** The registry answers *which directories hold
 * convertible material*; this answers *which fields those files carry*, and it
 * exists because the second question turned out to be the one we were getting
 * wrong. A field we have never heard of is not a hole — it is one aggregated
 * note per file saying so, which is only checkable against a list somebody
 * committed.
 *
 * Provenance, for every set below:
 *   source  SillyTavern, the files named per set
 *   commit  06bde939fb1e9c4c8d8641d810f0a916b5bce127 (1.19.0, 2026-09-14)
 *   taken   2026-09-22
 *   was     8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8 (1.18.0+1, 2026-07-07);
 *           every set here is byte-identical at both, except the chat-completion
 *           preset keys, which gained `pollinations_endpoint`
 *
 * **Every set was extracted from the source rather than typed**, and each one's
 * size is pinned by `vocabulary.test.ts`, because a list transcribed by hand is
 * a list with one name missing and no way to notice.
 *
 * Two sets this file deliberately does not hold yet, each landing with the code
 * that first reads it: the keys books written by *other* tools carry, which is
 * the converter's business, and the image types SillyTavern will serve as a
 * sprite, which is resolved against its own `mime-types` copy when a real
 * install is built.
 */

/** How the version stamp is compared. See `SILLYTAVERN_CHECKED_VERSION`. */
export type SillyTavernVersion = string;

/**
 * The world-info entry fields, with the type SillyTavern itself declares.
 *
 * `newWorldInfoEntryDefinition` (`public/scripts/world-info.js:4002-4049`) has
 * forty-two, three of which are marked `excludeFromTemplate` — the UI-only
 * `characterFilterNames`/`Tags`/`Exclude`, which are written back as the single
 * `characterFilter` object. The thirty-nine that remain are what a saved entry
 * carries, plus four the file adds elsewhere: `uid` (the shard key of the
 * entries object), `displayIndex`, `characterFilter`, and `extensions` on
 * entries that came in from a card.
 *
 * **The `?` types are the whole reason this table is typed rather than a bare
 * list.** SillyTavern writes `null` to mean *use the global setting*, and says
 * so in its own declaration: a reader that takes `null` for `false` quietly
 * changes how every imported entry matches.
 */
export const WI_ENTRY_TYPES = {
  key: 'array',
  keysecondary: 'array',
  comment: 'string',
  content: 'string',
  constant: 'boolean',
  vectorized: 'boolean',
  selective: 'boolean',
  selectiveLogic: 'enum',
  addMemo: 'boolean',
  order: 'number',
  position: 'number',
  disable: 'boolean',
  ignoreBudget: 'boolean',
  excludeRecursion: 'boolean',
  preventRecursion: 'boolean',
  matchPersonaDescription: 'boolean',
  matchCharacterDescription: 'boolean',
  matchCharacterPersonality: 'boolean',
  matchCharacterDepthPrompt: 'boolean',
  matchScenario: 'boolean',
  matchCreatorNotes: 'boolean',
  delayUntilRecursion: 'number',
  probability: 'number',
  useProbability: 'boolean',
  depth: 'number',
  outletName: 'string',
  group: 'string',
  groupOverride: 'boolean',
  groupWeight: 'number',
  scanDepth: 'number?',
  caseSensitive: 'boolean?',
  matchWholeWords: 'boolean?',
  useGroupScoring: 'boolean?',
  automationId: 'string',
  role: 'enum',
  sticky: 'number?',
  cooldown: 'number?',
  delay: 'number?',
  triggers: 'array',
  // Not in the template, but on every stored entry.
  uid: 'number',
  displayIndex: 'number',
  characterFilter: 'object',
  extensions: 'object',
} as const satisfies Record<
  string,
  'array' | 'boolean' | 'boolean?' | 'enum' | 'number' | 'number?' | 'object' | 'string'
>;

export const WI_ENTRY_KEYS: readonly string[] = Object.keys(WI_ENTRY_TYPES);

/**
 * The keys a world file itself carries.
 *
 * `entries` is the only one SillyTavern requires (`src/endpoints/worldinfo.js:116`),
 * and `/edit` writes whatever body it is given, so the other three are what its
 * own writers add: `originalData` on a book converted from a card
 * (`world-info.js:5499`), and `name` and `extensions`, which its listing reads
 * back (`worldinfo.js:48-56`).
 */
export const WI_BOOK_KEYS: readonly string[] = ['entries', 'originalData', 'name', 'extensions'];

/**
 * The entry keys of an embedded `character_book`, in the V2 spec's own shape.
 *
 * SillyTavern writes twelve of these on every card linked to a world
 * (`src/endpoints/characters.js:670-681`); the spec allows three more that its
 * writer never emits, and other tools do. **This is not the world-file shape** —
 * `keys` not `key`, `insertion_order` not `order`, `enabled` not `disable`, and
 * a *string* position — which is the defect [P4 §7.19] exists for.
 */
export const SPEC_ENTRY_KEYS: readonly string[] = [
  'id',
  'keys',
  'secondary_keys',
  'comment',
  'content',
  'constant',
  'selective',
  'insertion_order',
  'enabled',
  'position',
  'use_regex',
  'extensions',
  // The V2 spec's, which SillyTavern's own writer does not emit.
  'name',
  'priority',
  'case_sensitive',
];

/**
 * What lives under a spec entry's `extensions`, which is where SillyTavern puts
 * everything the spec has no field for (`characters.js:682-715`).
 *
 * The spec calls `extensions` open, so an unknown key here is not worth a note:
 * it is carried to metadata and the file's own `unknownFields` count ignores it.
 */
export const V2_BOOK_EXTENSION_KEYS: readonly string[] = [
  'position',
  'exclude_recursion',
  'display_index',
  'probability',
  'useProbability',
  'depth',
  'selectiveLogic',
  'outlet_name',
  'group',
  'group_override',
  'group_weight',
  'prevent_recursion',
  'delay_until_recursion',
  'scan_depth',
  'match_whole_words',
  'use_group_scoring',
  'case_sensitive',
  'automation_id',
  'role',
  'vectorized',
  'sticky',
  'cooldown',
  'delay',
  'match_persona_description',
  'match_character_description',
  'match_character_personality',
  'match_character_depth_prompt',
  'match_scenario',
  'match_creator_notes',
  'triggers',
  'ignore_budget',
];

/**
 * Every key a chat-completion preset file carries.
 *
 * `settingsToUpdate` (`public/scripts/openai.js:305-409`) is what
 * `getChatCompletionPreset` writes, so a saved preset has all of them. The five
 * after it are in SillyTavern's own shipped `Default.json` and not in that map,
 * and the three after those are pre-prompt-manager names its loader migrates
 * (`PromptManager.js:46-71`) — all eight are known rather than unknown, which is
 * the only thing this list decides.
 */
export const CHAT_PRESET_KEYS: readonly string[] = [
  'chat_completion_source',
  'temperature',
  'frequency_penalty',
  'presence_penalty',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'repetition_penalty',
  'max_context_unlocked',
  'group_models',
  'sort_models',
  'openai_model',
  'claude_model',
  'openrouter_model',
  'openrouter_use_fallback',
  'openrouter_providers',
  'openrouter_quantizations',
  'openrouter_allow_fallbacks',
  'openrouter_middleout',
  'tool_reasoning_mode',
  'ai21_model',
  'mistralai_model',
  'cohere_model',
  'perplexity_model',
  'groq_model',
  'chutes_model',
  'siliconflow_model',
  'siliconflow_endpoint',
  'minimax_model',
  'minimax_endpoint',
  'electronhub_model',
  'nanogpt_model',
  'nanogpt_provider',
  'nanogpt_payg_override',
  'deepseek_model',
  'aimlapi_model',
  'xai_model',
  'pollinations_model',
  'pollinations_endpoint',
  'moonshot_model',
  'fireworks_model',
  'cometapi_model',
  'custom_model',
  'custom_url',
  'custom_include_body',
  'custom_exclude_body',
  'custom_include_headers',
  'custom_prompt_post_processing',
  'google_model',
  'vertexai_model',
  'zai_model',
  'zai_endpoint',
  'workers_ai_model',
  'workers_ai_account_id',
  'openai_max_context',
  'openai_max_tokens',
  'names_behavior',
  'send_if_empty',
  'impersonation_prompt',
  'new_chat_prompt',
  'new_group_chat_prompt',
  'new_example_chat_prompt',
  'continue_nudge_prompt',
  'bias_preset_selected',
  'reverse_proxy',
  'wi_format',
  'scenario_format',
  'personality_format',
  'group_nudge_prompt',
  'stream_openai',
  'prompts',
  'prompt_order',
  'show_external_models',
  'proxy_password',
  'assistant_prefill',
  'assistant_impersonation',
  'use_sysprompt',
  'vertexai_auth_mode',
  'vertexai_region',
  'vertexai_express_project_id',
  'squash_system_messages',
  'media_inlining',
  'inline_image_quality',
  'continue_prefill',
  'continue_postfix',
  'function_calling',
  'tool_call_recurse_limit',
  'show_thoughts',
  'reasoning_effort',
  'verbosity',
  'enable_web_search',
  'seed',
  'n',
  'bypass_status_check',
  'request_images',
  'request_image_aspect_ratio',
  'request_image_resolution',
  'azure_base_url',
  'azure_deployment_name',
  'azure_api_version',
  'azure_openai_model',
  'extensions',
  // In the shipped Default.json, absent from `settingsToUpdate`.
  'openrouter_group_models',
  'openrouter_sort_models',
  'chutes_sort_models',
  'electronhub_sort_models',
  'electronhub_group_models',
  // Migrated on load, so a file written before the prompt manager still has them.
  'main_prompt',
  'nsfw_prompt',
  'jailbreak_prompt',
];

/**
 * Which field holds the model, per `chat_completion_source`.
 *
 * From `getChatCompletionModel` (`openai.js:1698-1758`), which is the only
 * honest answer: a preset file carries *every* provider's model field, so
 * reading them all produces a list of models the preset was never for.
 * `openrouter` is the one that can answer nothing, when the model is the
 * website's own default.
 */
export const CHAT_COMPLETION_MODEL_FIELD: Readonly<Record<string, string>> = {
  openai: 'openai_model',
  claude: 'claude_model',
  openrouter: 'openrouter_model',
  ai21: 'ai21_model',
  makersuite: 'google_model',
  vertexai: 'vertexai_model',
  mistralai: 'mistralai_model',
  custom: 'custom_model',
  cohere: 'cohere_model',
  perplexity: 'perplexity_model',
  groq: 'groq_model',
  electronhub: 'electronhub_model',
  chutes: 'chutes_model',
  nanogpt: 'nanogpt_model',
  deepseek: 'deepseek_model',
  aimlapi: 'aimlapi_model',
  xai: 'xai_model',
  pollinations: 'pollinations_model',
  moonshot: 'moonshot_model',
  fireworks: 'fireworks_model',
  cometapi: 'cometapi_model',
  azure_openai: 'azure_openai_model',
  zai: 'zai_model',
  workers_ai: 'workers_ai_model',
  siliconflow: 'siliconflow_model',
  minimax: 'minimax_model',
};

/**
 * The prompts every chat-completion preset is assumed to have, and the order
 * they are in when a file names none.
 *
 * `chatCompletionDefaultPrompts` and `promptManagerDefaultPromptOrder`
 * (`PromptManager.js:2001` and `:2087`). SillyTavern restores a missing default
 * prompt rather than dropping the order entry that names it (`:1017-1056`), so
 * a reader that drops it imports a preset the person never saw. Eight of the
 * twelve are markers, which is where the prose actually comes from.
 */
export const CHAT_COMPLETION_DEFAULT_PROMPTS: readonly string[] = [
  'main',
  'nsfw',
  'dialogueExamples',
  'jailbreak',
  'chatHistory',
  'worldInfoAfter',
  'worldInfoBefore',
  'enhanceDefinitions',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
];

/** The order used when a preset carries none, `identifier` then `enabled`. */
export const ST_DEFAULT_PROMPT_ORDER: readonly { identifier: string; enabled: boolean }[] = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'enhanceDefinitions', enabled: false },
  { identifier: 'nsfw', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
];

/**
 * The id a chat-completion prompt order is stored under.
 *
 * **`100001`, not `100000`.** `PromptManager` defaults `dummyId` to 100000, and
 * the chat-completion manager overrides it to 100001 (`openai.js:689`) — which
 * it has done since 2023-08, so 100000 in a real file is an order nobody has
 * edited in two years. Reading the wrong one drops whatever the person changed,
 * and in SillyTavern's own shipped preset it drops the persona block outright.
 */
export const CHAT_COMPLETION_ORDER_ID = 100001;

/** The older id, kept to recognise and report rather than to read. */
export const LEGACY_PROMPT_ORDER_ID = 100000;

/**
 * Every key a text-completion preset file carries.
 *
 * `setting_names` (`public/scripts/textgen-settings.js:248-322`) plus three the
 * preset writer adds: `rep_pen_size` in the shipped presets, and `genamt` and
 * `max_length`, which are the response length and the *context* size
 * (`preset-manager.js:745-746`) — a pairing worth naming here, because taking
 * `max_length` for the response length is the reading that looks obvious.
 */
export const TEXTGEN_KEYS: readonly string[] = [
  'temp',
  'temperature_last',
  'rep_pen',
  'rep_pen_range',
  'rep_pen_decay',
  'rep_pen_slope',
  'no_repeat_ngram_size',
  'top_k',
  'top_p',
  'top_a',
  'tfs',
  'epsilon_cutoff',
  'eta_cutoff',
  'typical_p',
  'min_p',
  'penalty_alpha',
  'num_beams',
  'length_penalty',
  'min_length',
  'dynatemp',
  'min_temp',
  'max_temp',
  'dynatemp_exponent',
  'smoothing_factor',
  'smoothing_curve',
  'dry_allowed_length',
  'dry_multiplier',
  'dry_base',
  'dry_sequence_breakers',
  'dry_penalty_last_n',
  'max_tokens_second',
  'encoder_rep_pen',
  'freq_pen',
  'presence_pen',
  'skew',
  'do_sample',
  'early_stopping',
  'seed',
  'add_bos_token',
  'ban_eos_token',
  'skip_special_tokens',
  'include_reasoning',
  'streaming',
  'mirostat_mode',
  'mirostat_tau',
  'mirostat_eta',
  'guidance_scale',
  'negative_prompt',
  'grammar_string',
  'json_schema',
  'banned_tokens',
  'global_banned_tokens',
  'send_banned_tokens',
  'ignore_eos_token',
  'spaces_between_special_tokens',
  'speculative_ngram',
  'sampler_order',
  'sampler_priority',
  'samplers',
  'samplers_priorities',
  'n',
  'logit_bias',
  'custom_model',
  'bypass_status_check',
  'openrouter_allow_fallbacks',
  'xtc_threshold',
  'xtc_probability',
  'nsigma',
  'min_keep',
  'generic_model',
  'extensions',
  'json_schema_allow_empty',
  'adaptive_target',
  'adaptive_decay',
  'rep_pen_size',
  'genamt',
  'max_length',
];

/** A system-prompt file, which is all three of these and nothing else. */
export const SYSPROMPT_KEYS: readonly string[] = ['name', 'content', 'post_history'];

/**
 * What a persona descriptor holds (`public/scripts/personas.js:523-530`), plus
 * the `connections` a persona tied to a character or group carries (`:925-927`).
 */
export const PERSONA_DESCRIPTOR_KEYS: readonly string[] = [
  'description',
  'position',
  'depth',
  'role',
  'lorebook',
  'title',
  'connections',
];

/** The world-info settings a lorebook's matching depends on. */
export interface WorldInfoGlobals {
  depth: number;
  budget: number;
  includeNames: boolean;
  recursive: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useGroupScoring: boolean;
  characterStrategy: number;
  budgetCap: number;
  minActivations: number;
  minActivationsDepthMax: number;
  maxRecursionSteps: number;
}

/**
 * SillyTavern's module defaults, which is what an install falls back to **per
 * missing key** (`world-info.js:66-83`, applied at `:917-943`).
 *
 * **Not the same as what it ships**, and the two disagree on the two that
 * matter: a key absent from a present `settings.json` means whole-word matching
 * is *off* and recursion is *off*, while a fresh install's `settings.json` says
 * both are on. Using the shipped values as the per-key fallback would turn
 * matching on for entries whose install had it off.
 */
export const ST_MODULE_WORLD_INFO: WorldInfoGlobals = {
  depth: 2,
  budget: 25,
  includeNames: true,
  recursive: false,
  caseSensitive: false,
  matchWholeWords: false,
  useGroupScoring: false,
  characterStrategy: 0,
  budgetCap: 0,
  minActivations: 0,
  minActivationsDepthMax: 0,
  maxRecursionSteps: 0,
};

/**
 * What a fresh install's `settings.json` says
 * (`default/content/settings.json:10-23`).
 *
 * Used only when there is no `settings.json` at all — a single uploaded book,
 * a CHARX, a card from anywhere — because then the honest guess is what the
 * application these files came from ships, not what its module declares.
 */
export const ST_SHIPPED_WORLD_INFO: WorldInfoGlobals = {
  ...ST_MODULE_WORLD_INFO,
  depth: 2,
  budget: 25,
  includeNames: true,
  recursive: true,
  caseSensitive: false,
  matchWholeWords: true,
  characterStrategy: 1,
  budgetCap: 0,
};

/**
 * The generation kinds an entry or a prompt can be limited to
 * (`public/scripts/constants.js:36-43`).
 *
 * An empty list means *always*; a non-empty one means the generation must be in
 * it (`PromptManager.js:1549-1553`).
 */
export const GENERATION_TYPE_TRIGGERS: readonly string[] = [
  'normal',
  'continue',
  'impersonate',
  'swipe',
  'regenerate',
  'quiet',
];
