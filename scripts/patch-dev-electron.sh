#!/usr/bin/env bash
# Gives the dev Electron host a calendar usage string, so `npm run dev` can
# actually exercise the macOS permission prompt.
#
# macOS will not show a calendar prompt for an app bundle without
# NSCalendarsFullAccessUsageDescription: requestFullAccessToEvents() fails
# immediately. The packaged app gets the key from electron-builder.yml's
# mac.extendInfo, which never reaches node_modules/electron, so under
# `npm run dev` the request could not be made at all and connecting Apple
# Calendar could never succeed.
#
# Skips, loudly and successfully, wherever it cannot apply — this runs on the
# way into `npm run dev` and a developer on another OS, or without the stock
# Electron unpacked yet, should get a sentence rather than a failure. It is
# also silent and does nothing when the key is already there, which is every
# run after the first.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$root/node_modules/electron/dist/Electron.app"
plist="$app/Contents/Info.plist"
key="NSCalendarsFullAccessUsageDescription"

# Deliberately not the packaged app's wording. The prompt this produces is
# titled "Electron", and the grant is held against com.github.Electron rather
# than against Up Next, so it should say which of the two is asking.
usage="Up Next (development build) reads the calendars already set up on this Mac so it can show the day ahead. It only reads, and nothing leaves your Mac."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "skipping the dev Electron patch: calendar permissions are macOS-only (this is $(uname -s))"
  exit 0
fi

if [[ ! -f "$plist" ]]; then
  echo "skipping the dev Electron patch: no $plist yet (run npm run setup first)"
  exit 0
fi

current="$(/usr/libexec/PlistBuddy -c "Print :$key" "$plist" 2>/dev/null || true)"
if [[ "$current" == "$usage" ]]; then
  exit 0
fi

# Added or set: a stale string from an earlier version of this script has to be
# replaced, not duplicated.
if ! /usr/libexec/PlistBuddy -c "Add :$key string $usage" "$plist" >/dev/null 2>&1; then
  if ! /usr/libexec/PlistBuddy -c "Set :$key $usage" "$plist" >/dev/null 2>&1; then
    echo "skipping the dev Electron patch: could not write $key into $plist"
    exit 0
  fi
fi

# Preserved rather than dropped: signing without them would strip whatever the
# bundle came with. The stock Electron.app currently carries none, so this is
# usually an empty file and the --entitlements flag is left off entirely.
entitlements="$(mktemp -t up-next-electron-entitlements)"
trap 'rm -f "$entitlements"' EXIT
codesign -d --entitlements "$entitlements" --xml "$app" >/dev/null 2>&1 || true

signed=0
if [[ -s "$entitlements" ]]; then
  codesign --force --sign - --entitlements "$entitlements" "$app" >/dev/null 2>&1 && signed=1
else
  codesign --force --sign - "$app" >/dev/null 2>&1 && signed=1
fi

# A dev run that cannot start is worse than one that cannot prompt, so a failed
# signature puts the bundle back exactly as it was and says so.
if [[ "$signed" -ne 1 ]]; then
  /usr/libexec/PlistBuddy -c "Delete :$key" "$plist" >/dev/null 2>&1 || true
  echo "skipping the dev Electron patch: could not re-sign $app, so it was left alone"
  exit 0
fi

echo "patched the dev Electron host with $key; the prompt will be titled Electron"
