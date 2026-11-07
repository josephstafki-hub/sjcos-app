#!/bin/bash
# Offline coordinator only. Never starts a browser, listener or service.
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
exec /usr/bin/python3 -I -B "$here/provision_acceptance.py" provision "$@"
