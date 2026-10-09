"""Refreshing docs also refreshes tarball and all checksums, removes old pages."""
import hashlib
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import agents_doc
import release
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    target=root/'macos-arm64'
    shutil.copytree('dist-ci/macos-arm64',target)
    (target/'docs/stale.md').write_text('obsolete')
    assert agents_doc.refresh_out_dir(str(root),release.read_version())==0
    assert not (target/'docs/stale.md').exists()
    assert (target/'docs/SDK.md').read_bytes()==Path('docs/SDK.md').read_bytes()
    for line in (target/'SHA256SUMS.txt').read_text().splitlines():
        sha,name=line.split('  ',1)
        assert hashlib.sha256((target/name).read_bytes()).hexdigest()==sha,name
    with tarfile.open(root/'russiano2d-macos-arm64.tar.gz') as archive:
        assert archive.extractfile('./docs/SDK.md').read()==Path('docs/SDK.md').read_bytes()
        assert './docs/stale.md' not in archive.getnames()
    sha=(root/'SHA256SUMS.txt').read_text().split()[0]
    assert hashlib.sha256((root/'russiano2d-macos-arm64.tar.gz').read_bytes()).hexdigest()==sha
print('PASS: docs, tarball, inner/global SHA256 synchronized; obsolete page removed')
