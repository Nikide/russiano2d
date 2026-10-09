"""Packaging rejects wrong architecture before deleting an existing package."""
import sys
from pathlib import Path
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import release
with tempfile.TemporaryDirectory() as tmp:
    binary=Path(tmp)/'sample'
    for cpu,expected in [(0x1000007,'macos-x86_64'),(0x100000c,'macos-arm64')]:
        binary.write_bytes(b'\xcf\xfa\xed\xfe'+cpu.to_bytes(4,'little')+bytes(56))
        assert release.binary_platform(str(binary))==expected
    for cpu,expected in [(62,'linux-x86_64'),(183,'linux-aarch64')]:
        header=bytearray(64);header[:4]=b'\x7fELF';header[5]=1;header[18:20]=cpu.to_bytes(2,'little')
        binary.write_bytes(header);assert release.binary_platform(str(binary))==expected
    header=bytearray(70);header[:2]=b'MZ';header[60:64]=(64).to_bytes(4,'little');header[64:70]=b'PE\0\0\x64\x86'
    binary.write_bytes(header);assert release.binary_platform(str(binary))=='windows-x86_64'
    wrong = 'linux-x86_64' if release.binary_platform('build/russiano2d') != 'linux-x86_64' else 'macos-arm64'
    target=Path(tmp)/'out'/wrong;target.mkdir(parents=True)
    sentinel=target/'keep';sentinel.write_text('keep')
    try:
        release.package_platform(release.Runner(False),wrong,'build/russiano2d',str(Path(tmp)/'out'),False,release.read_version(),force=True)
    except SystemExit as e:
        assert 'архитектуру' in str(e),e
    else:raise AssertionError('Wrong architecture accepted')
    assert sentinel.read_text()=='keep'
print('PASS: five architectures recognized; mismatch rejected before package deletion')
