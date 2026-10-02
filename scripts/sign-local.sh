#!/usr/bin/env bash
#
# Ad-hoc signs the packaged app so it runs on this machine (docs/spec.md §8.8).
#
# Not a substitute for the release build: that one is signed with a Developer
# ID and notarised, and keeps the hardened runtime. This one deliberately does
# not. With the hardened runtime on, macOS enforces library validation, and an
# ad-hoc signature carries no Team ID for the frameworks to match — so the app
# refuses to load its own Electron framework. The alternative would be the
# disable-library-validation entitlement, which reopens the code-injection
# path §8.8 closes.
#
# `codesign --deep` does not work here either: it gives every nested binary its
# own identity, which fails the same validation. Signing runs inside out.

set -euo pipefail

APP="${1:-dist/mac-arm64/Pinned Calendar.app}"
ENTITLEMENTS="build/entitlements.mac.plist"
FRAMEWORKS="${APP}/Contents/Frameworks"
ELECTRON="${FRAMEWORKS}/Electron Framework.framework/Versions/A"

if [ ! -d "${APP}" ]; then
  echo "No app at ${APP}. Run npm run package first." >&2
  exit 1
fi

for binary in "${ELECTRON}/Libraries/"*.dylib "${ELECTRON}/Helpers/"*; do
  [ -f "${binary}" ] && codesign --force --sign - "${binary}"
done

for framework in "${FRAMEWORKS}/"*.framework; do
  codesign --force --sign - "${framework}/Versions/A"
done

for helper in "${FRAMEWORKS}/"*.app; do
  codesign --force --sign - --entitlements "${ENTITLEMENTS}" "${helper}"
done

codesign --force --sign - --entitlements "${ENTITLEMENTS}" "${APP}"
codesign --verify --deep --strict "${APP}"

echo "Signed ${APP}. Copy it to /Applications to install."
