# Funkin’ Studio

Browser-based FNF modding editor.

- **Web:** Open [`index.html`](index.html) (the entry point for GitHub Pages).
- **Source:** [`funkin-studio/`](funkin-studio/) contains CSS, JavaScript (ES Modules, one `State` class per screen), icons, docs, and the standalone build script.
- **Local dev:** `python -m http.server` then open `http://localhost:8000/` (ES Modules need a server).
- **Offline build:** Run `python funkin-studio/build.py`; output is `funkin-studio/dist/Funkin_Studio.html`.

GitHub Pages is deployed through `.github/workflows/static.yml`. Enable **GitHub Actions** as the Pages build source in repository settings.
