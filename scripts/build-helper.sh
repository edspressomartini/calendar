#!/usr/bin/env bash
# Builds the EventKit helper and places it where the app and electron-builder
# both expect it. Never commit the output: see .gitignore.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package="$root/resources/eventkit-helper"
output="$root/build/helper"

swift build --package-path "$package" -c release --arch arm64
mkdir -p "$output"
cp "$(swift build --package-path "$package" -c release --arch arm64 --show-bin-path)/UpNextEventKit" \
  "$output/up-next-eventkit"
echo "built $output/up-next-eventkit"
