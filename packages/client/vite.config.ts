// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The client is served by Vite in development and talks to the server over
    // `/api` (docs/api.md). Proxying keeps the two same-origin, which is what
    // lets the session cookie stay SameSite=Lax with no CORS at all.
    // The port the dev server listens on, so a scratch install on another port
    // is reachable without editing this file. Defaults to the config default.
    port: Number(process.env['SE_CLIENT_PORT'] ?? 5173),
    proxy: {
      '/api': process.env['SE_API'] ?? 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
