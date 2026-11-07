#!/bin/bash
set -euo pipefail
# Coordinator-only root install; no browser process, service or live checkout.
# Usage: install-playwright.sh PRISTINE_CORE_PACKAGE NEW_PATCHED_CORE_PACKAGE
# Launcher source install is separate from bundle replacement so root can review
# and stage both before changing the dedicated isolated package path.
if [[ $(id -u) == 0 && $# == 1 && $1 == --launcher ]]; then
  script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
  repo_dir=$(cd -- "$script_dir/../.." && pwd)
  /usr/bin/python3 - "$repo_dir" <<'PYINSTALL'
import hashlib,json,os,pathlib,stat,sys
src=pathlib.Path(sys.argv[1]);base=pathlib.Path('/opt/sjcos-browser/node/source')
files=json.loads((src/'deploy/browser/playwright-patch/launcher-files.json').read_text())
for name,expected in files.items():
 p=src/name
 if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise SystemExit('BROWSER_SOURCE_HASH_MISMATCH:'+name)
for name in files:
 target=base/name
 target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
 for p in (target.parent,*target.parent.parents):
  st=p.lstat()
  if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:raise SystemExit('BROWSER_INSTALL_DIRECTORY_REFUSED')
 if target.exists() or target.is_symlink():raise SystemExit('BROWSER_INSTALL_FRESH_SOURCE_REQUIRED')
 fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb') as f:f.write((src/name).read_bytes());f.flush();os.fsync(f.fileno())
print('Installed source only; no authority configuration or acceptance claim.')
PYINSTALL
  exit 0
fi
[[ $(id -u) == 0 && $# == 2 && $1 = /* && $2 = /opt/sjcos-browser/* && ! -e $2 ]] || exit 64
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(realpath -- "$1")
[[ $(/usr/bin/node -p 'require(process.argv[1]).version' "$source_dir/package.json") == 1.64.1 ]] || exit 65
/usr/bin/node --input-type=module -e 'import {createHash} from "node:crypto"; import {readFileSync} from "node:fs"; if(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex")!=="829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d")process.exit(65)' "$source_dir/lib/coreBundle.js"
mkdir -m 700 -- "$2"
trap 'rm -rf -- "$2"' ERR
cp -a -- "$source_dir/." "$2/"
rm -- "$2/lib/coreBundle.js"
# apply writes only new files; preserve all other package resources/dependencies.
rm -f -- "$2/lib/sjc-patch.json"
/usr/bin/node "$script_dir/playwright-patch/apply.mjs" "$source_dir/lib/coreBundle.js" "$2/lib"
chown -R root:root -- "$2"
chmod -R go-w -- "$2"
