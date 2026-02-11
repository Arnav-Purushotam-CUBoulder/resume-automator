#!/bin/zsh
set -euo pipefail

APP_NAME="Resume Automator.app"
APP_BIN_NAME="Resume Automator"
SRC_APP="$PWD/release/mac-arm64/$APP_NAME"
DEST_APP="/Applications/$APP_NAME"

if [[ ! -d "$SRC_APP" ]]; then
  echo "Build artifact not found at: $SRC_APP"
  echo "Run: npm run desktop:dir"
  exit 1
fi

# Stop running instances before replacement.
pkill -f "$DEST_APP/Contents/MacOS/$APP_BIN_NAME" >/dev/null 2>&1 || true

# Ensure there is only one app copy in /Applications.
find /Applications -maxdepth 1 -name 'Resume Automator.app.bak.*' -exec rm -rf {} +

# Replace the installed app in-place.
rm -rf "$DEST_APP"
cp -R "$SRC_APP" "$DEST_APP"

# Remove the build app bundle so Spotlight does not index a duplicate.
rm -rf "$SRC_APP"

echo "Installed: $DEST_APP"
