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

    # --- Новое правило: внутренние рабочие документы не едут в поставку -------
    # (tools/release.py: INTERNAL_DOCS). Проверяются ОБЕ двери: каталог docs/ в
    # пакете и склеенный AGENTS.md.
    leaked=[]
    for path in (target/'docs').rglob('*.md'):
        rel=str(path.relative_to(target))
        if release.is_internal_doc(rel):
            leaked.append(rel)
    assert not leaked, 'внутренние документы попали в пакет: %s' % leaked
    assert not (target/'SDK_HANDOFF.md').exists(), 'журнал SDK_HANDOFF.md попал в пакет'
    packaged=sorted(str(p.relative_to(target/'docs')) for p in (target/'docs').rglob('*.md'))
    expected=sorted(str(p.relative_to('docs')) for p in Path('docs').rglob('*.md')
                    if not release.is_internal_doc(str(p)))
    assert packaged==expected, ('состав публичных документов в пакете разошёлся с репозиторием: '
        'лишние %s, потеряны %s' % (sorted(set(packaged)-set(expected)), sorted(set(expected)-set(packaged))))
    agents_text=(target/'AGENTS.md').read_text()
    # Содержимое внутреннего документа в приложении видно по обёртке, которую
    # ставит agents_docs_appendix(): TOC-строка и маркер источника. Проверять
    # просто имя файла нельзя: публичные доки упоминают его как указатель.
    internal_files=[]
    for entry in release.INTERNAL_DOCS:
        path=Path(entry)
        if path.is_dir():
            internal_files += sorted(str(p) for p in path.rglob('*.md'))
        elif path.is_file():
            internal_files.append(str(path))
    assert internal_files, 'список INTERNAL_DOCS не нашёл ни одного файла — правило перестало работать'
    for name in internal_files:
        assert ('<sub>источник: `%s`</sub>' % name) not in agents_text, \
            'внутренний документ %s уехал в приложение AGENTS.md' % name
        # Строка оглавления приложения имеет вид "* <title> — `docs/...`";
        # просто подстрока «— `путь`» ловит и обычные ссылки публичных доков
        # (например, VFX_ROADMAP упоминает внутреннее решение по Effekseer).
        toc_line = re.compile(r"(?m)^\* .+ — `" + re.escape(name) + r"`$")
        assert not toc_line.search(agents_text), \
            'внутренний документ %s попал в оглавление AGENTS.md' % name
    assert 'docs/HIGH_LEVEL_API.md' in agents_text and 'docs/highlevel/' in agents_text, \
        'публичная документация из AGENTS.md пропала'
    print('PASS: docs, tarball, inner/global SHA256 synchronized; obsolete page removed; '
          'repack reproducible; внутренние документы не попали ни в docs/, ни в AGENTS.md '
          '(публичных .md в пакете: %d)' % len(packaged))
