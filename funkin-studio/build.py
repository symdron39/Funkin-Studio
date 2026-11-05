#!/usr/bin/env python3
"""Build standalone Funkin' Studio HTML with inline CSS, JS and icon assets.

Run: python build.py
Output: dist/Funkin_Studio.html
Source index.html and assets are never modified.
"""
import base64
import json
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'funkin-studio' / 'dist' / 'Funkin_Studio.html'
html = (ROOT / 'index.html').read_text(encoding='utf-8')


def asset_path(href):
    rel = href.split('?', 1)[0].split('#', 1)[0].lstrip('/')
    path = (ROOT / rel).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise FileNotFoundError(f'Missing or unsafe local asset: {href}')
    return path


def data_uri(href):
    path = asset_path(href)
    mime = {'.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'}.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def css_inline(match):
    href = match.group(1)
    css = asset_path(href).read_text(encoding='utf-8').replace('</style', '<\\/style')
    return f'<style>\n/* ===== {href} ===== */\n{css}\n</style>'


def js_inline(match):
    src = match.group(1)
    js = asset_path(src).read_text(encoding='utf-8')
    js = re.sub(r'</script', r'<\\/script', js, flags=re.I)
    return f'<script>\n/* ===== {src} ===== */\n{js}\n</script>'


html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', css_inline, html)
html = re.sub(r'<script\s+src="([^"]+)"\s*>\s*</script>', js_inline, html)

# Inline all locally referenced favicon and touch icons. Keep other tags unchanged.
def inline_icon(match):
    tag = match.group(0)
    href_match = re.search(r'\bhref="([^"]+)"', tag)
    if not href_match:
        return tag
    href = href_match.group(1)
    return tag.replace(f'href="{href}"', f'href="{data_uri(href)}"')

html = re.sub(r'<link\b(?=[^>]*\brel="(?:icon|shortcut icon|apple-touch-icon)")[^>]*>', inline_icon, html, flags=re.I)

# The standalone manifest has embedded icon URLs. Browsers may not support
# installation from a data: manifest or file:// URL; favicon works offline.
def inline_manifest(match):
    tag = match.group(0)
    href_match = re.search(r'\bhref="([^"]+)"', tag)
    if not href_match:
        return tag
    href = href_match.group(1)
    manifest = json.loads(asset_path(href).read_text(encoding='utf-8'))
    manifest['name'] = "Funkin' Studio"
    manifest['short_name'] = "Funkin' Studio"
    manifest['theme_color'] = '#15356e'
    manifest['background_color'] = '#15356e'
    for icon in manifest.get('icons', []):
        src = icon.get('src')
        if src and not src.startswith(('data:', 'http:', 'https:')):
            icon['src'] = data_uri(str(Path(href).parent / src))
    encoded = base64.b64encode(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).decode('ascii')
    return tag.replace(f'href="{href}"', f'href="data:application/manifest+json;base64,{encoded}"')

html = re.sub(r'<link\b(?=[^>]*\brel="manifest")[^>]*>', inline_manifest, html, flags=re.I)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(html, encoding='utf-8')
print(f'Built {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)')
