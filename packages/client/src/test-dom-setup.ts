// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmounts what a test rendered, between tests.
 *
 * Testing Library registers this itself when the framework's hooks are
 * globals — and this repo imports `describe`/`it`/`expect` explicitly instead,
 * so it never gets the chance. Without it, renders accumulate into one document
 * and the failure is `getByRole` reporting *multiple* matches: a message that
 * reads like an ambiguous query rather than a leaked previous test.
 *
 * It lives in the vitest project's `setupFiles` rather than in each test,
 * because the first component test is not the interesting one to get right.
 */
afterEach(cleanup);
