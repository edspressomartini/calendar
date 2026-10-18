#!/usr/bin/env bash
# Runs the EventKit helper's Swift tests, which are the only guard against the
# Zod schemas in EventKitProtocol.ts and the Swift encoder drifting apart.
#
# Skips, loudly and successfully, where the toolchain cannot be there: the app
# is macOS-only but `npm run check` is run constantly, and a contributor on
# Linux or on a Mac without the command line tools should get a sentence
# telling them what was not run, not a confusing failure. CI runs the same
# command directly, on macOS, so a skip there is impossible.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package="$root/resources/eventkit-helper"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "skipping swift test: the EventKit helper only builds on macOS (this is $(uname -s))"
  exit 0
fi

# Not `command -v swift`: macOS ships a stub that exists and then fails when
# the command line tools are absent.
if ! swift --version >/dev/null 2>&1; then
  echo "skipping swift test: no working Swift toolchain (install Xcode or the command line tools)"
  exit 0
fi

swift test --package-path "$package"
