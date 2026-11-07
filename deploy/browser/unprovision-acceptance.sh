#!/bin/bash
# Reverses only this provisioner's journal; never kills or restarts anything.
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
exec /usr/bin/python3 -I -B "$here/provision_acceptance.py" unprovision "$@"
