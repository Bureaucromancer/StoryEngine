// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './index.css';
import { applyTheme, readMirroredTheme } from './ui/theme.js';

/**
 * The theme, before anything renders.
 *
 * The authority is `prefs.json` and `useTheme` applies it, but that read is a
 * request and this runs synchronously — so without the mirrored copy every load
 * would paint the system theme first and correct itself once the answer came
 * back. For anyone whose choice differs from their OS that is a white flash on
 * every navigation, which is how a theme setting stops being used.
 *
 * It runs before the sign-in gate too, and deliberately: the person at this
 * browser gets their theme on the login screen, before there is an account to
 * have a preference. `useTheme` reconciles with the server once there is one.
 */
applyTheme(readMirroredTheme());

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root mount point in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
