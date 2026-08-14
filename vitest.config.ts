// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'lint-rules',
          root: '.',
          include: ['tools/lint-fixtures/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'packages',
          root: '.',
          include: ['packages/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
