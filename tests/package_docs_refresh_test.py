"""Refreshing docs also refreshes tarball and all checksums, removes old pages.

Проверка герметична: пакет собирается во временном каталоге, а не берётся из
``dist-ci/`` (тот появляется только после упаковки и в чистом дереве его нет).
Отдельно закреплена воспроизводимость: повторное обновление документов даёт
байт-в-байт тот же архив, а не только тот же список файлов.
"""
import hashlib
from pathlib import Path
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import agents_doc
import release
version=release.read_version()
archive_name=release.archive_name('macos-arm64',version)
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    target=root/'macos-arm64'
    target.mkdir(parents=True)
    (target/'docs').mkdir()
    (target/'docs/stale.md').write_text('obsolete')
    (target/'russiano2d').write_bytes(b'#!stub\n')
    # Архив со старым именем (без версии) рядом: после обновления он обязан
    # исчезнуть, иначе в каталоге релиза окажутся две копии одной платформы.
    legacy=root/'russiano2d-macos-arm64.tar.gz'
    legacy.write_bytes(b'legacy')
    assert agents_doc.refresh_out_dir(str(root),version)==0
    assert not legacy.exists(), 'устаревший архив без версии остался в каталоге релиза'
    assert len((root/'SHA256SUMS.txt').read_text().splitlines())==1, \
        'в сводных суммах должен остаться ровно один архив'
    assert not (target/'docs/stale.md').exists()
    assert (target/'docs/SDK.md').read_bytes()==Path('docs/SDK.md').read_bytes()
    for line in (target/'SHA256SUMS.txt').read_text().splitlines():
        sha,name=line.split('  ',1)
        assert hashlib.sha256((target/name).read_bytes()).hexdigest()==sha,name
    with tarfile.open(root/archive_name) as archive:
        assert archive.extractfile('./docs/SDK.md').read()==Path('docs/SDK.md').read_bytes()
        assert './docs/stale.md' not in archive.getnames()
    sha=(root/'SHA256SUMS.txt').read_text().split()[0]
    assert hashlib.sha256((root/archive_name).read_bytes()).hexdigest()==sha
    first=hashlib.sha256((root/archive_name).read_bytes()).hexdigest()
    assert agents_doc.refresh_out_dir(str(root),version)==0
    assert hashlib.sha256((root/archive_name).read_bytes()).hexdigest()==first, \
        'повторная упаковка после обновления документов изменила архив'
print('PASS: docs, tarball, inner/global SHA256 synchronized; obsolete page removed; repack reproducible')
