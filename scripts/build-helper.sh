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
echo "built $output/up-next-eventkit"
