#!/bin/bash
# Installs Infimeety on a Mac, as a normal app in Applications that updates itself:
#   curl -fsSL https://infimeety.pages.dev/install-mac.sh | bash
# Running it again reinstalls the newest version.
set -euo pipefail

APP="/Applications/Infimeety.app"
LATEST="https://github.com/teamcreatovert/infimeety/releases/latest/download/latest.json"

echo "Installing Infimeety..."

# The same file the app checks for updates: it names the newest Mac app (one build for Apple and Intel chips).
URL=$(curl -fsSL "$LATEST" | grep -o 'https://[^"]*universal\.app\.tar\.gz' | head -1 || true)
if [ -z "$URL" ]; then
  echo "Couldn't find the download. Check your internet connection and try again."
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar "$URL" -o "$TMP/infimeety.tar.gz"
tar -xzf "$TMP/infimeety.tar.gz" -C "$TMP"

# Close a running copy, then swap the app in Applications (asks for your Mac password only if it must).
osascript -e 'quit app "Infimeety"' >/dev/null 2>&1 || true
sleep 1
if [ -e "$APP" ]; then rm -rf "$APP" 2>/dev/null || sudo rm -rf "$APP"; fi
mv "$TMP/Infimeety.app" "$APP" 2>/dev/null || sudo mv "$TMP/Infimeety.app" "$APP"

# Downloaded apps get a "from the internet" mark that makes macOS block apps without an Apple
# certificate ("damaged" or "can't be opened"). This copy came straight from Infimeety's releases.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || sudo xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

open "$APP"
echo "Done. Infimeety is in your Applications folder and updates itself."
