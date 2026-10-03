#!/usr/bin/env bash
#
# Builds, ad-hoc signs and replaces /Applications/Up Next.app (docs/spec.md §8.8).
#
# The installed app is a copy, not a link: changing the source does nothing to
# it until it is rebuilt. This is the whole loop in one command, for a local
# machine only. Released builds come from the release workflow, signed with a
# Developer ID and notarised.
#
# The running copy has to be quit first. macOS will happily replace the bundle
# underneath a running process, which leaves it executing code that no longer
# exists on disk and behaving strangely until it is restarted.

set -euo pipefail

APP_NAME="Up Next"
BUILT="dist/mac-arm64/${APP_NAME}.app"
INSTALLED="/Applications/${APP_NAME}.app"

if pgrep -x "${APP_NAME}" >/dev/null; then
  echo "Quitting ${APP_NAME}…"
  osascript -e "quit app \"${APP_NAME}\"" || true
  for _ in $(seq 1 20); do
    pgrep -x "${APP_NAME}" >/dev/null || break
    sleep 0.5
  done
  if pgrep -x "${APP_NAME}" >/dev/null; then
    echo "${APP_NAME} is still running. Quit it and try again." >&2
    exit 1
  fi
fi

npm run package

rm -rf "${INSTALLED}"
cp -R "${BUILT}" "${INSTALLED}"

echo "Installed ${INSTALLED}. Open it from Spotlight or /Applications."
