# Funkin’ Studio

The web entry point is [`../index.html`](../index.html). Styles, scripts, and icons are stored in this directory.

## Build a standalone offline HTML

From the repository root:

```bash
python funkin-studio/build.py
```

Or from this directory:

```bash
python build.py
```

Output: `funkin-studio/dist/Funkin_Studio.html`. The build embeds local CSS, JavaScript, favicon, touch icon, and manifest icons as data URLs. The source files are unchanged. Browser PWA installation is not guaranteed from a `file://` URL.

## GitHub Pages

The repository-root `index.html` is the entry point. GitHub Actions deploys the static site from the repository.
