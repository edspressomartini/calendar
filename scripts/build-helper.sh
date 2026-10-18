#!/usr/bin/env bash
# Builds the EventKit helper and places it where the app and electron-builder
# both expect it. Never commit the output: see .gitignore.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package="$root/resources/eventkit-helper"
output="$root/build/helper"

swift build --package-path "$package" -c release --arch arm64

# Resolved once and reused: asking a second time means any extra line the
# toolchain prints ends up spliced into the path we copy from.
bin="$(swift build --package-path "$package" -c release --arch arm64 --show-bin-path)"

mkdir -p "$output"
cp "$bin/UpNextEventKit" "$output/up-next-eventkit"

# Re-signed because it was copied. `swift build` leaves a linker-signed ad-hoc
# binary, which is only valid where the linker put it: the copy here has the
# same bytes and is killed on launch as `Taskgated Invalid Signature`, so
# `npm run dev` could never start the helper at all. The packaged build signs
# this binary again with the Developer ID through `mac.binaries`, which
# replaces this signature rather than depending on it.
codesign --force --sign - "$output/up-next-eventkit"
echo "built $output/up-next-eventkit"
