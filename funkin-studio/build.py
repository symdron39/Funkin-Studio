#!/usr/bin/env python3
"""Build standalone Funkin' Studio HTML with inline CSS, JS and icon assets.

Run: python build.py
Output: dist/Funkin_Studio.html
Source index.html and assets are never modified.

JS は ES Modules（import / export）で書かれている。ブラウザは file:// から
モジュールを読めないので、オフライン用の単一 HTML では、
全モジュールを「1つの普通の <script>」にまとめ直す（下の bundle_modules）。
まとめ方:
  1. main.js から import をたどって、使われているファイルを集める
  2. 依存される側が先になる順（トポロジカル順）に並べる
  3. 各ファイルを関数で包み（= 変数が衝突しない）、export したものを return し、
     import は「前に作ったモジュールの戻り値から取り出す」文に置き換える
対応している書き方（このプロジェクトの規約）:
  ・import は 1行で書く:  import { A, B as C } from "./x.js";
  ・export は  export class / function / const / let  のみ（export default や 再export は使わない）
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


def embed_contributor_images(js):
    # Embed local contributor image paths in the standalone build.
    def embed(match):
        original = match.group(2)
        if original.startswith(('https://', 'http://', 'data:')):
            return match.group(0)
        return match.group(1) + data_uri(original) + match.group(3)
    return re.sub(r'(?m)^(\s*image\s*:\s*["\'])([^"\']+)(["\'])', embed, js)


IMPORT_RE = re.compile(r'^import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+"([^"]+)";[ \t]*$', re.M)
EXPORT_RE = re.compile(r'^export\s+((?:async\s+)?(?:class|function\*?|const|let|var))\s+([A-Za-z_$][\w$]*)', re.M)


def bundle_modules(entry_rel):
    """entry (例: funkin-studio/js/main.js) から import をたどり、1つの IIFE スクリプトにまとめる。"""
    order, seen = [], {}  # order: 依存される側が先

    def visit(path):
        if path in seen:
            return
        seen[path] = None  # 循環の検出用（この規約では循環なしのはず）
        src = path.read_text(encoding='utf-8')
        if path.name == 'contributors.js':
            src = embed_contributor_images(src)
        deps = []
        for m in IMPORT_RE.finditer(src):
            dep = (path.parent / m.group(3)).resolve()
            if not dep.is_file():
                raise FileNotFoundError(f'{path.name}: import "{m.group(3)}" not found')
            deps.append(dep)
            visit(dep)
        seen[path] = src
        order.append(path)

    visit((ROOT / entry_rel).resolve())

    var = {p: f'__m{i}' for i, p in enumerate(order)}
    out = []
    for path in order:
        src = seen[path]

        def to_const(m):
            names, default, spec = m.group(1), m.group(2), m.group(3)
            if default:
                raise SyntaxError(f'{path.name}: default import is not supported')
            target = var[(path.parent / spec).resolve()]
            parts = []
            for n in names.split(','):
                n = n.strip()
                if not n:
                    continue
                if ' as ' in n:
                    a, b = [x.strip() for x in n.split(' as ')]
                    parts.append(f'{a}: {b}')
                else:
                    parts.append(n)
            return f'const {{ {", ".join(parts)} }} = {target};'

        src = IMPORT_RE.sub(to_const, src)
        exported = [m.group(2) for m in EXPORT_RE.finditer(src)]
        src = EXPORT_RE.sub(lambda m: f'{m.group(1)} {m.group(2)}', src)
        if re.search(r'^(export|import)\s', src, re.M):
            raise SyntaxError(f'{path.name}: unsupported import/export syntax remains')
        rel = path.relative_to(ROOT).as_posix()
        out.append(f'/* ===== {rel} ===== */\nconst {var[path]} = (() => {{\n{src}\nreturn {{ {", ".join(exported)} }};\n}})();')
    return '"use strict";\n' + '\n\n'.join(out)


def js_module_inline(match):
    bundle = bundle_modules(match.group(1))
    bundle = re.sub(r'</script', r'<\\/script', bundle, flags=re.I)
    return f'<script>\n{bundle}\n</script>'


html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', css_inline, html)
html = re.sub(r'<script\s+type="module"\s+src="([^"]+)"\s*>\s*</script>', js_module_inline, html)

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
            icon_path = str(Path(href).parent / src)
            try:
                icon['src'] = data_uri(icon_path)
            except FileNotFoundError:
                icon['src'] = data_uri(str(Path(href).parent / 'images' / src))
    encoded = base64.b64encode(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).decode('ascii')
    return tag.replace(f'href="{href}"', f'href="data:application/manifest+json;base64,{encoded}"')

html = re.sub(r'<link\b(?=[^>]*\brel="manifest")[^>]*>', inline_manifest, html, flags=re.I)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(html, encoding='utf-8')
print(f'Built {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)')
