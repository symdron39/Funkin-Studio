# Funkin' Studio

## 構成
- `index.html` … 画面の骨組み（ホーム → Sparrow → Animate → Character Editor の順）
- `css/` … base / layout / character-editor
- `js/` … 機能ごとに1ファイル（読み込み順は index.html 末尾）
- `build.py` … 1ファイル版を作る → `dist/Funkin_Studio.html`

## 編集の流れ
1. `index.html` / `css/*.css` / `js/*.js` を編集
2. `python3 build.py` を実行
3. `dist/Funkin_Studio.html` が配布用の1ファイル版

ブラウザで `index.html` を直接開いても動きます（ビルド不要）。
