# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 StoryEngine contributors
#
# Alpha 1's image — docs/design/workplan/23-p6a-alpha-1.md §2, P6A.4.
#
# **An artifact, not a distribution.** The repository is private, the registry
# package is private, and nobody else runs this (§0.1). That is what keeps
# docs/design/workplan/11-repo-and-releases.md §0's deferral of release
# engineering intact, and what keeps AGPL §13 from attaching
# (docs/design/04-server-multiuser-deployment.md §7). Publishing this image is a
# decision to publish the repository at the same instant; §4 says so, and says it
# there so that it cannot happen by way of a registry visibility toggle.
#
# Build it with the two arguments the release workflow passes:
#
#   docker build --build-arg COMMIT=$(git rev-parse HEAD) \
#                --build-arg VERSION=v0.1.0-alpha.1 -t storyengine .

ARG NODE_VERSION=26

# --- build ------------------------------------------------------------------
#
# `slim` rather than `alpine`, and it is a deliberate few tens of megabytes:
# this server formats numbers and dates against a user's locale
# (docs/design/04-server-multiuser-deployment.md §4.2), and a musl base with a
# trimmed ICU is exactly the sort of difference that shows up as one wrong
# separator in one language rather than as a build failure. Nothing here needs a
# native compiler — SQLite is `node:sqlite`, built in — so the usual reason to
# reach for alpine does not apply.
FROM node:${NODE_VERSION}-slim AS build

# pnpm from corepack, at the version `packageManager` in package.json pins. The
# plan's own words: `.npmrc` is `engine-strict=true`, so a base older than the
# `engines.node` floor fails hard here rather than warning and continuing.
RUN corepack enable

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
ARG COMMIT
ARG VERSION
RUN test -n "$COMMIT" || (echo 'COMMIT build-arg is required.' >&2; exit 1)
RUN node tools/write-build-info.mjs --commit "$COMMIT" \
    ${VERSION:+--expect-version "$VERSION"}

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

# The client is a separate package and not a dependency of the server, so it is
# copied rather than deployed. `SE_CLIENT_ROOT` below points at it.
RUN cp -r packages/client/dist /app/client

# --- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

# **`0.0.0.0`, by the documented variable and not by a different build.**
# docs/design/workplan/21-p10-implementation.md §1.2 forbids the image shipping
# a baked default the bare-metal build does not have: *a hidden difference
# between artifacts is a support burden shaped like a security feature*. This is
# a line anybody can read and override with `-e SE_HOST=…`, and the port mapping
# is the operator's explicit act (docs/design/04-server-multiuser-deployment.md
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
# (docs/design/02-data-model.md §5). Created and owned before the volume is
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
