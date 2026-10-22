"""Refreshing docs also refreshes tarball and all checksums, removes old pages.

Проверка герметична: пакет собирается во временном каталоге, а не берётся из
``dist-ci/`` (тот появляется только после упаковки и в чистом дереве его нет).
Отдельно закреплена воспроизводимость: повторное обновление документов даёт
байт-в-байт тот же архив, а не только тот же список файлов.
"""
import hashlib
import re
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
    for stale in ('editor','templates','assets','game'):
        (target/stale).mkdir()
        (target/stale/'old.txt').write_text('obsolete')
    (target/'russiano2d').write_bytes(b'#!stub\n')
    # Архив со старым именем (без версии) рядом: после обновления он обязан
    # исчезнуть, иначе в каталоге релиза окажутся две копии одной платформы.
    legacy=root/'russiano2d-macos-arm64.tar.gz'
    legacy.write_bytes(b'legacy')
    assert agents_doc.refresh_out_dir(str(root),version)==0
    assert not legacy.exists(), 'устаревший архив без версии остался в каталоге релиза'
    assert len((root/'SHA256SUMS.txt').read_text().splitlines())==1, \
        'в сводных суммах должен остаться ровно один архив'
    for stale in ('docs','editor','templates','assets','game'):
        assert not (target/stale).exists(), 'каталог %s/ от прежней сборки остался: он вшит в бинарник' % stale
    for line in (target/'SHA256SUMS.txt').read_text().splitlines():
        sha,name=line.split('  ',1)
        assert hashlib.sha256((target/name).read_bytes()).hexdigest()==sha,name
    with tarfile.open(root/archive_name) as archive:
        names=archive.getnames()
        assert not [n for n in names if n.split('/')[1:2] and n.split('/')[1] in ('docs','editor','templates','assets','game')], 'вшитый в бинарник каталог уехал в архив'
    sha=(root/'SHA256SUMS.txt').read_text().split()[0]
    assert hashlib.sha256((root/archive_name).read_bytes()).hexdigest()==sha
    first=hashlib.sha256((root/archive_name).read_bytes()).hexdigest()
    assert agents_doc.refresh_out_dir(str(root),version)==0
    assert hashlib.sha256((root/archive_name).read_bytes()).hexdigest()==first, \
        'повторная упаковка после обновления документов изменила архив'

    # --- Документации рядом с бинарником нет: она вшита в r2d --------------------
    # AGENTS.md короткий и объясняет, как достать доки командой `r2d docs`.
    assert not (target/'SDK_HANDOFF.md').exists(), 'журнал SDK_HANDOFF.md попал в пакет'
    assert not list(target.rglob('*.md')) or all(p.name in ('AGENTS.md','README.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md')
        for p in target.rglob('*.md')), 'в пакет попали лишние .md'
    agents_text=(target/'AGENTS.md').read_text()
    assert len(agents_text.encode('utf-8'))<8*1024, 'AGENTS.md снова разросся: %d байт' % len(agents_text.encode('utf-8'))
    for cmd in ('docs list','docs show','docs search','docs context','docs api'):
        assert cmd in agents_text, 'в AGENTS.md нет команды `%s`' % cmd
    assert '{{' not in agents_text, 'в AGENTS.md остались неподставленные поля шаблона'
    assert '<sub>источник:' not in agents_text and 'Приложение: вся документация' not in agents_text, \
        'в AGENTS.md снова склеена вся документация'
    print('PASS: docs, tarball, inner/global SHA256 synchronized; obsolete page removed; '
          'repack reproducible; docs/ нет в пакете, AGENTS.md короткий и ведёт к `r2d docs`')
