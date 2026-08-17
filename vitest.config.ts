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

      /**
       * Component tests — F16.
       *
       * `.test.tsx` was included by tsconfig and by eslint and by nothing here,
       * so the first component test anyone wrote would have linted, typechecked
       * and never run. The split is by extension rather than by directory, and
       * that is what keeps the two projects from both claiming a file: vitest
       * runs a file once per matching project, and `api.test.ts` says in its
       * own docstring that it needs the node environment (`request()` reads
       * `document.cookie`, and it is asserting the branch where there is no
       * document).
       *
       * jsdom is declared at the workspace root because vitest imports it from
       * inside its own bundle, while `@testing-library/react` is declared in
       * `packages/client` because the root has no React and a second copy of it
       * fails as "Invalid hook call" — which reads as a bug in the component
       * rather than in the setup.
       */
      {
        test: {
          name: 'client-dom',
          root: '.',
          include: ['packages/client/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['packages/client/src/test-dom-setup.ts'],
        },
      },
    ],
  },
});
