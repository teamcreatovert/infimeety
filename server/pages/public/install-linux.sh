#!/bin/bash
# Installs Infimeety on Linux, as an app in your menu that updates itself:
#   curl -fsSL https://infimeety.pages.dev/install-linux.sh | bash
# Running it again installs the newest version. Nothing goes outside your home folder.
set -euo pipefail

DIR="$HOME/.local/share/infimeety"
APP="$DIR/Infimeety.AppImage"

echo "Installing Infimeety..."
mkdir -p "$DIR" "$HOME/.local/share/applications" "$HOME/.local/bin"

# Download next to the old copy, then swap, so a running Infimeety isn't cut off halfway.
curl -fL --progress-bar "https://github.com/teamcreatovert/infimeety/releases/latest/download/Infimeety.AppImage" -o "$APP.new"
chmod +x "$APP.new"
mv -f "$APP.new" "$APP"
curl -fsSL "https://infimeety.pages.dev/icon.png" -o "$DIR/icon.png" || true

# In the app menu, and as `infimeety` in a terminal.
cat > "$HOME/.local/share/applications/infimeety.desktop" <<EOF
[Desktop Entry]
Name=Infimeety
Comment=Voice rooms, chat, screen sharing and watch parties with your friends
Exec="$APP" %u
Icon=$DIR/icon.png
Terminal=false
Type=Application
Categories=Network;Chat;AudioVideo;
MimeType=x-scheme-handler/infimeety;
StartupWMClass=Infimeety
EOF
ln -sf "$APP" "$HOME/.local/bin/infimeety"
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

# AppImages need FUSE 2; most desktops have it. Say so plainly if this one doesn't.
if ! ldconfig -p 2>/dev/null | grep -q libfuse.so.2; then
  echo "Note: Infimeety needs FUSE 2 to start. On Ubuntu or Debian: sudo apt install libfuse2"
fi

nohup "$APP" >/dev/null 2>&1 &
echo "Done. Infimeety is in your app menu and updates itself."
