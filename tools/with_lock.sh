#!/bin/bash
# Cross-platform build/test lock for concurrent agents on macOS (no flock(1)).
# Usage: tools/with_lock.sh <lock-name> '<shell command>'
set -u
if [ "$#" -lt 2 ]; then
    echo "usage: $0 <lock-name> '<command>'" >&2
    exit 2
fi
exec python3 - "$1" "$2" <<'PY'
import fcntl, os, subprocess, sys
name, command = sys.argv[1], sys.argv[2]
path = "/tmp/r2d-agent-%s.lock" % name
fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o666)
fcntl.flock(fd, fcntl.LOCK_EX)
try:
    rc = subprocess.call(["/bin/bash", "-lc", command])
finally:
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)
sys.exit(rc)
PY
