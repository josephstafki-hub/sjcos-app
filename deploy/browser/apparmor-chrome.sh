#!/bin/bash
# Coordinator, root. Lets ONLY the pinned acceptance Chromium create the user namespaces its
# own sandbox needs on Ubuntu 24.04 (kernel.apparmor_restrict_unprivileged_userns=1).
# Same shape as Ubuntu's stock /etc/apparmor.d/chrome. Never use --no-sandbox instead.
#   install: write + load the profile      remove: unload + delete it
set -euo pipefail
PROFILE=/etc/apparmor.d/sjcos-browser-chrome
BIN=/opt/sjcos-browser/browsers/chromium-1248/chrome-linux64/chrome
[ "$(id -u)" = 0 ] || { echo "BROWSER_APPARMOR_ROOT_REQUIRED" >&2; exit 1; }
case "${1:-}" in
  install)
    [ -x "$BIN" ] && [ "$(stat -c %U "$BIN")" = root ] || { echo "BROWSER_APPARMOR_BINARY_UNTRUSTED" >&2; exit 1; }
    tmp=$(mktemp /etc/apparmor.d/.sjcos-browser-chrome.XXXXXX)
    cat > "$tmp" <<PROFILE
# SJC OS agent browser acceptance (deploy/browser/apparmor-chrome.sh). Remove with: apparmor-chrome.sh remove
abi <abi/4.0>,
include <tunables/global>

profile sjcos-browser-chrome $BIN flags=(unconfined) {
  userns,
}
PROFILE
    chmod 0644 "$tmp"; chown root:root "$tmp"; mv -f "$tmp" "$PROFILE"
    apparmor_parser -r -W "$PROFILE"
    echo "Loaded AppArmor profile sjcos-browser-chrome for $BIN (userns only)."
    ;;
  remove)
    if [ -f "$PROFILE" ]; then apparmor_parser -R "$PROFILE" 2>/dev/null || true; rm -f "$PROFILE"; echo "Removed sjcos-browser-chrome profile."; else echo "No sjcos-browser-chrome profile; nothing changed."; fi
    ;;
  *) echo "usage: apparmor-chrome.sh install|remove" >&2; exit 2 ;;
esac
