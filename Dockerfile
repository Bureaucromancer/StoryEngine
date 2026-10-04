# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 StoryEngine contributors
#
# Alpha 1's image — docs/design/workplan/19-p6a-alpha-1.md §2, P6A.4.
#
# **An artifact, not a distribution.** The repository is private, the registry
# package is private, and nobody else runs this (§0.1). *(Noted 2026-10-04: the
# repository was decided public on 2026-10-03, for licensing and CI rather than
# readiness, and docs/design/workplan/04-repo-and-releases.md §0.1a records the
# day the switch itself lands. The rest of this paragraph rests on the package,
# which stays private either way.)* That is what keeps
# docs/design/workplan/04-repo-and-releases.md §0's deferral of release
# engineering intact, and what keeps AGPL §13 from attaching
# (docs/design/09-server-multiuser-deployment.md §7). Publishing this image is a
# decision to publish the repository at the same instant; §4 says so, and says it
# there so that it cannot happen by way of a registry visibility toggle.
#
# Build it with the three arguments the release workflow passes:
#
#   docker build --build-arg COMMIT=$(git rev-parse HEAD) \
#                --build-arg VERSION=1.0.0-alpha.1 \
#                --build-arg SOURCE=https://github.com/<owner>/<repo> -t storyengine .
#
# `SOURCE` may be left out, and the image then carries no Source link — which is
# honest, because nothing in it can say where its source is.

ARG NODE_VERSION=26

# --- build ------------------------------------------------------------------
#
# `slim` rather than `alpine`, and it is a deliberate few tens of megabytes:
# this server formats numbers and dates against a user's locale
# (docs/design/09-server-multiuser-deployment.md §4.2), and a musl base with a
# trimmed ICU is exactly the sort of difference that shows up as one wrong
# separator in one language rather than as a build failure. Nothing here needs a
# native compiler — SQLite is `node:sqlite`, built in — so the usual reason to
# reach for alpine does not apply.
FROM node:${NODE_VERSION}-slim AS build

# pnpm installed with npm, at the version `packageManager` in package.json pins,
# and `tools/release.test.ts` holds the two to one number. Not corepack: the
# plan said corepack, the first run of the release workflow (2026-09-06, tag
# v1.0.0-alpha.1) failed here with exit 127, and the reason is that Node 25
# stopped shipping corepack in its distribution — so `node:26-slim` has no
# such command, and nothing had run this file before a daemon did. The plan's
# other words still hold: `.npmrc` is `engine-strict=true`, so a base older
# than the `engines.node` floor fails hard at `pnpm install` rather than warning
# and continuing.
RUN npm install -g pnpm@11.18.0

# **`CI=true`, and it is not decoration.** pnpm asks before removing a modules
# directory and aborts when there is no TTY — measured, as
# `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, running the deploy step below by
# hand. A build that stops to ask a question nobody can answer is a build that
# fails at three in the morning for a reason the log states plainly and nobody
# reads.
ENV CI=true
WORKDIR /src

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# **The identity, written from what the builder was told.** There is no `.git`
# in the context — `.dockerignore` excludes it — so the commit arrives as an
# argument and `--expect-version` refuses a tag that disagrees with the root
# `package.json`. Both are required: an image that cannot say which commit it is
# defeats the phase it belongs to (§1.5).
#
# ***And where its source is*** (2026-10-01), for the same missing `.git`:
# `write-build-info.mjs` asks the `origin` remote, which this context does not
# have, so `--source` says it instead. Until the release passed it, the image
# carried no AGPL §13 link while the tarball, built from a checkout, carried
# one. Optional, like `VERSION`, and for the reason the header gives.
ARG COMMIT
ARG VERSION
ARG SOURCE
RUN test -n "$COMMIT" || (echo 'COMMIT build-arg is required.' >&2; exit 1)
RUN node tools/write-build-info.mjs --commit "$COMMIT" \
    ${VERSION:+--expect-version "$VERSION"} \
    ${SOURCE:+--source "$SOURCE"}

# **The prune story.** `pnpm deploy` copies one workspace package and its
# production dependencies into a self-contained tree, resolving the `workspace:*`
# entries — `@storyengine/shared` and `@storyengine/sdk` — into real directories.
# `--legacy` because pnpm 10 and later refuse the non-injected form otherwise,
# and this workspace does not set `inject-workspace-packages`.
#
# `build-info.json` travels because `packages/server/package.json` lists it in
# `files` beside `dist`; that is one declaration rather than a copy here that
# somebody has to remember.
RUN pnpm --filter @storyengine/server --legacy deploy --prod /app

# **The modes are not in the server's manifest** — P7.0.
#
# docs/design/20-tech-stack.md §10 makes "built-in modes consume the SDK and not
# the server" a build error, and a manifest edge would have been the one
# direction the lint rules cannot see. `mode-loader.ts` resolves each by bare
# specifier at run time instead, so what the image owes it is the package on the
# server's resolution path. Nothing in `/app/dist` imports one; Node finds it the
# same way it finds any other dependency.
#
# ~~The modes are deployed beside the server, not through it: `pnpm deploy`
# walks one package's dependency closure, and the server's does not include
# them, so each is deployed into `/app/node_modules/<name>` by name.~~
# ***They arrive with the server's deploy*** (2026-10-01). The root
# `package.json` declares them, and the pinned pnpm's legacy deploy carries the
# root's dependencies into the deployed tree — measured: `/app/node_modules/
# @storyengine/mode-*` are links after the line above. So the per-mode deploys
# that stood here met a path that was not empty and failed the build
# (`ERR_PNPM_DEPLOY_DIR_NOT_EMPTY`). Nothing noticed because nothing built: only
# a `v*` tag runs this file, and P7.0 added the root dependency a day after
# `v1.0.0-alpha.4`, the last one.
#
# **What the image owes the loader is checked instead, one `RUN` per mode.**
# Each mode is imported from `/app` as the server will import it; a pnpm that
# stopped carrying the root's dependencies fails here, at build time, rather
# than shipping a server whose `loadModes` refuses to start. A loop over a list
# would be a third place the shipped set is written — after the root
# `package.json` and `mode-loader.ts`'s `BUILT_IN_MODE_PACKAGES` — so the lines
# are explicit, and `tools/repo-shape.test.ts` holds them to the loader's list.
WORKDIR /app
RUN node --input-type=module -e "await import('@storyengine/mode-scene')"
RUN node --input-type=module -e "await import('@storyengine/mode-freeform')"
RUN node --input-type=module -e "await import('@storyengine/mode-assistant')"
WORKDIR /src

# The client is a separate package and not a dependency of the server, so it is
# copied rather than deployed. `SE_CLIENT_ROOT` below points at it.
RUN cp -r packages/client/dist /app/client

# --- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

# **`0.0.0.0`, by the documented variable and not by a different build.**
# docs/design/workplan/27-p10-implementation.md §1.2 forbids the image shipping
# a baked default the bare-metal build does not have: *a hidden difference
# between artifacts is a support burden shaped like a security feature*. This is
# a line anybody can read and override with `-e SE_HOST=…`, and the port mapping
# is the operator's explicit act (docs/design/09-server-multiuser-deployment.md
# §5.3). What makes that safe rather than merely unavoidable is the setup token,
# which this bind is precisely the condition for (§5.1).
ENV NODE_ENV=production \
    SE_DATA_DIR=/data \
    SE_HOST=0.0.0.0 \
    SE_PORT=8080 \
    SE_CLIENT_ROOT=/app/client

WORKDIR /app
COPY --from=build --chown=node:node /app /app

# `/data` is the whole of the install: library, sessions, accounts, config
# (docs/design/03-data-model.md §5). Created and owned before the volume is
# declared, so an anonymous volume inherits the ownership; a bind mount does
# not, and the deploy page says so.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

EXPOSE 8080
USER node

# `node dist/main.js`, not `pnpm start`: one process, so signals reach the
# server rather than a package manager that would have to forward them — and
# `main.ts` installs its own SIGINT and SIGTERM handlers to close the app and
# dispose its services.
CMD ["node", "dist/main.js"]
