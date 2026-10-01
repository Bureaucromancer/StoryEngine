#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 StoryEngine contributors
#
# Tier 2's install script — docs/design/09-server-multiuser-deployment.md §5.4,
# built at P11.9.
#
# **It answers §5.4's three questions and nothing else.** *Does it install
# cleanly with its dependencies* — node, and the script checks the floor rather
# than assuming. *Does it start on boot and come back after a reboot* — the unit
# beside this file, enabled. *Where does /data live, and does an upgrade leave it
# alone* — `/var/lib/storyengine`, created once and never touched again by this
# script, which is what makes re-running it the upgrade path.
#
# **Idempotent on purpose, because that is the upgrade.** Unpack the new tarball
# over `/opt/storyengine` and run this again: the user exists, the data directory
# exists and is left exactly as it is, the unit is rewritten, and the service
# restarts. There is no separate upgrade script to get out of step with this one.
set -eu

PREFIX="${PREFIX:-/opt/storyengine}"
DATA="${DATA:-/var/lib/storyengine}"
UNIT="${UNIT:-/etc/systemd/system/storyengine.service}"
SERVICE_USER="${SERVICE_USER:-storyengine}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: it creates a service user and writes a systemd unit." >&2
  exit 1
fi

# **The Node floor is checked rather than assumed**, because the failure it
# prevents is the worst kind available here: a service that installs, enables,
# starts, and dies on a syntax error at three in the morning. `.npmrc` sets
# `engine-strict=true` so a build refuses an old Node; an unpacked tarball has
# no such moment, and this is it.
NEED=26
HAVE="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)"
if [ "${HAVE:-0}" -lt "$NEED" ]; then
  echo "StoryEngine needs Node ${NEED} or newer; found ${HAVE:-none}." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$PREFIX"
# `-a` rather than a move, so a second run over an unpacked tree works, and
# `.` so the dotfiles a build may leave travel with it.
cp -a "$HERE"/. "$PREFIX"/
rm -f "$PREFIX/install.sh" "$PREFIX/storyengine.service"

# **Created, never emptied.** Everything a person has written lives here, and a
# script that "tidied" it would be the one-way door this whole tier is trying not
# to be. An upgrade is a re-run of this script and must leave it alone.
mkdir -p "$DATA"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA"
chown -R root:root "$PREFIX"

install -m 0644 "$HERE/storyengine.service" "$UNIT"
systemctl daemon-reload
systemctl enable storyengine
systemctl restart storyengine

# **Started is not running, and this script used to say it was** (2026-10-01).
# `Type=simple` makes the unit active the moment node is forked, so `restart`
# returning means a process exists and nothing more: a server that died on its
# first import a second later was reported installed while systemd restarted it
# every five seconds. So the start-up is waited out and the question asked
# again. A server that died since is waiting out `RestartSec`, or running again
# under another PID, and either is a failure to say rather than a success.
first="$(systemctl show --property=MainPID --value storyengine)"
sleep 10
if [ "$first" = 0 ] || ! systemctl is-active --quiet storyengine ||
  [ "$(systemctl show --property=MainPID --value storyengine)" != "$first" ]; then
  echo "StoryEngine is installed in ${PREFIX}, but it is not running. The end of its log:" >&2
  journalctl -u storyengine -n 30 --no-pager >&2 || true
  exit 1
fi

cat <<MESSAGE
StoryEngine is installed in ${PREFIX} and its data lives in ${DATA}.

It listens on 127.0.0.1:8080. To reach it from another machine, edit SE_HOST in
${UNIT} and run: systemctl daemon-reload && systemctl restart storyengine

The first-run setup token is printed in the log:
  journalctl -u storyengine -n 50
MESSAGE
