#!/usr/bin/env python3
"""Export a private diagnostic archive without SQL, scripts or access tokens.

Usage: python3 scripts/export-forecast-trace.py OUTPUT.zip RUN_DIRECTORY [...]
Original evidence stays untouched. The manifest hashes every regular input file;
JSON reviews/results and visible HTML text are included for diagnosis, never reuse.
"""
import hashlib
import json
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

SECRET = re.compile(r"token|password|secret|authorization|api.?key|cookie|guest.?id", re.I)
URL = re.compile(r"https?://[^\s<>\"']+")


def safe_text(value):
    def clean(match):
        parts = urlsplit(match.group(0))
        path = '/[redacted-api-path]' if parts.hostname == 'frpg.predicted11.com' else parts.path
        return urlunsplit((parts.scheme, parts.hostname or '', path, '', ''))
    value = URL.sub(clean, value)
    value = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[redacted-jwt]', value)
    return value


def sanitize(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if SECRET.search(key):
                result[key] = '[redacted]'
            elif key == 'query':
                raw = str(item).encode()
                result[key] = {'omitted': 'SQL', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
            else:
                result[key] = sanitize(item)
        return result
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        if value.lstrip().startswith(('{', '[')):
            try:
                return json.dumps(sanitize(json.loads(value)), ensure_ascii=False)
            except (ValueError, RecursionError):
                pass
        return safe_text(value)
    return value


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'head'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'head') and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


def export(output, directories):
    manifest = {'purpose': 'Diagnostic only; never fresh publication evidence',
                'raw_sql_and_scripts': False, 'files': [], 'runs': []}
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for index, directory in enumerate(directories, 1):
            directory = Path(directory)
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError('Expected a regular run directory')
            prefix = f'{index:02d}-{directory.name}'
            manifest['runs'].append(prefix)
            for file in sorted(directory.rglob('*')):
                if file.is_symlink():
                    raise ValueError('Symlinks are not accepted')
                if not file.is_file():
                    continue
                raw = file.read_bytes()
                relative = f'{prefix}/{file.relative_to(directory)}'
                entry = {'path': relative, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                         'modified_at_ns': file.stat().st_mtime_ns, 'included': False}
                if file.suffix in ('.json', '.jsonl', '.ndjson'):
                    try:
                        if file.suffix == '.json':
                            content = json.dumps(sanitize(json.loads(raw)), ensure_ascii=False, indent=2)
                        else:
                            lines = []
                            invalid = []
                            for number, line in enumerate(raw.splitlines(), 1):
                                if not line.strip():
                                    continue
                                try:
                                    lines.append(json.dumps(sanitize(json.loads(line)), ensure_ascii=False))
                                except (ValueError, UnicodeDecodeError):
                                    invalid.append({'line': number, 'bytes': len(line),
                                                    'sha256': hashlib.sha256(line).hexdigest()})
                            content = '\n'.join(lines) + '\n'
                            if invalid:
                                entry['invalid_lines'] = invalid
                        archive.writestr(relative, content)
                        entry['included'] = True
                    except (ValueError, UnicodeDecodeError):
                        entry['omitted_reason'] = 'Incomplete or invalid JSON; original hash retained'
                elif file.suffix == '.html':
                    parser = VisibleText()
                    parser.feed(raw.decode('utf-8', errors='replace'))
                    archive.writestr(relative + '.visible.txt', safe_text('\n'.join(parser.parts)))
                    entry['included'] = 'visible-text-only'
                else:
                    entry['omitted_reason'] = 'Raw transport/script artifact; original hash retained'
                manifest['files'].append(entry)
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        archive.writestr('README.txt', 'Private diagnostic archive. Original timestamps/hashes and complete parsed reviews/results are retained. SQL text, scripts, access tokens and URL queries are omitted. Captured HTML is represented as visible text; original hashes identify the unmodified bodies. Not valid as new publication evidence.\n')
    return manifest


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('Usage: export-forecast-trace.py OUTPUT.zip RUN_DIRECTORY [...]')
    result = export(Path(sys.argv[1]), sys.argv[2:])
    print(json.dumps({'path': sys.argv[1], 'runs': len(result['runs']), 'files': len(result['files'])}))
