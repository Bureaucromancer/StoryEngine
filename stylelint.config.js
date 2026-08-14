// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { stylelintRules } from './stylelint.rules.js';

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-use-logical'],
  ignoreFiles: ['**/dist/**', '**/node_modules/**', 'tools/lint-fixtures/fixtures/**'],
  rules: stylelintRules,
};
