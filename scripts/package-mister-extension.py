"""Build a reproducible installation ZIP from reviewed, local extension files."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
extension = root / 'mister-extension'
(extension / 'mister-import-core.js').write_bytes((root / 'mister-import-core.js').read_bytes())
version = json.loads((extension / 'manifest.json').read_text())['version']
destination = root / 'downloads' / f'Cuban-League-Mister-{version}.zip'
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(extension.iterdir()):
        if not path.is_file():
            continue
        info = zipfile.ZipInfo('Cuban-League-Mister/' + path.name, (2026, 9, 5, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
print(str(destination))
print('SHA256 ' + hashlib.sha256(destination.read_bytes()).hexdigest())
