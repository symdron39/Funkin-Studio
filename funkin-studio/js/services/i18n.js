/* ============================================================
   services/i18n.js — 日本語 / English の切り替え
   ------------------------------------------------------------
   仕組み: 画面の日本語テキストを、辞書(dictionary)に従って英語へ置き換える。
           元の日本語は覚えておくので、いつでも日本語に戻せる。
   英語対応を足すには:
     ① HTML の要素に data-ja="日本語" data-en="English" を付ける（この指定が最優先）
     ② 辞書(dictionary)に  日本語: "English"  を1行足す（テキスト・placeholder・title が対象）
   エディタ側のコードは言語を気にせず日本語でメッセージを出せば、ここが自動で翻訳する。

   目次: 1.翻訳辞書 2.数字入りの文言 3.変換の仕組み 4.I18n クラス（言語の切り替えと、画面の変化の監視）
   ============================================================ */
// このファイルのトップレベルの変数(dictionary など)は、モジュールの外からは見えない（IIFE で包む必要がなくなった）
// ============================================================
// 1. 翻訳辞書
// ============================================================
// 日本語の文言(キー) → 英語(値)。画面のテキストがキーと完全一致したとき（前後の空白は無視）に英訳する。
// 下の Object.assign で後から追加している分は、同じキーがあれば後のものが優先される。
// 追加分1: ホーム・Animate・Sparrow 関連
const dictionary = {
  レンダータイプを選択: "Choose a renderer",
  "アニメーションを編集": "Edit Animations",
  "使用するアトラス形式を選んでください。未対応の形式は今後のアップデートで追加予定です。":
    "Select an atlas format. More formats are coming.",
  使用可能: "Available",
  今後対応: "Coming soon",
  非推奨: "Don't Use",
  "←メインメニューへ": "←Back to MainMenu",
  "こんにちは！もしよければ、このツールの評価とバグ報告をGithubに残して行ってください！": "Hi guys! if you'd like, please report some issues!",
  "Character Editor / 今後実装予定": "Character Editor / Coming soon",
  "今後実装予定": "Coming Soon",
  "今日は、何をしよう。": "What shall You do today?",
  "現在のエディタ / Animation.json + spritemap JSON + PNG":
    "Current editor / Animation.json + spritemap JSON + PNG",
  専用アニメーション形式: "Animation format",
  専用シンボル形式: "Symbol format",
  "1. ファイルを読み込む": "1. Load files",
  "アトラス画像 (PNG)": "Atlas image (PNG)",
  "追加するパーツ画像 (PNG/WebP)": "Additional sprite images (PNG/WebP)",
  "パーツZIP (atlas_parts/*.png + atlas_manifest.json)":
    "Sprite ZIP (atlas_parts/*.png + atlas_manifest.json)",
  "ZIPから復元 / 一括読み込み": "Restore / batch import from ZIP",
  "PNG追加・アトラス再構築": "Add PNG / rebuild atlas",
  "読み込み / 更新": "Load / refresh",
  "Animation.json保存": "Export Animation.json",
  "spritemap JSON保存 (最小化)": "Export minified spritemap JSON",
  アトラスPNG保存: "Export atlas PNG",
  "▶ 再生": "▶ Play",
  "◀ 1F": "◀ 1 frame",
  "1F ▶": "1 frame ▶",
  "− 縮小": "− Zoom out",
  "＋ 拡大": "+ Zoom in",
  全体表示: "Fit to view",
  "固定した中心を使用（表示のみ）": "Use fixed preview center (display only)",
  中央に合わせる: "Recenter",
  "アニメーション / シンボル": "Animation / Symbol",
  フレーム: "Frame",
  ズーム: "Zoom",
  編集するレイヤー: "Edit layer",
  現在位置に複製: "Duplicate at frame",
  "空のキーフレーム（非表示）": "Blank keyframe (hide)",
  キーフレーム削除: "Delete keyframe",
  最後のキーを末尾まで延長: "Extend last keyframe",
  "2. フレーム内のパーツ": "2. Frame elements",
  選択要素をこのフレームから解除: "Remove selected element from frame",
  未使用スプライトをAtlasから削除: "Delete unused sprite from atlas",
  "3. 選択パーツの変換 (MX / M3D)": "3. Selected element transform (MX)",
  "回転角度 (°、左回転はマイナス)": "Rotation (°, negative = left)",
  指定角度だけ回転: "Rotate by angle",
  変換を適用: "Apply transform",
  選択解除: "Clear selection",
  "レイヤーを前面へ ▲": "Move layer forward ▲",
  "レイヤーを背面へ ▼": "Move layer backward ▼",
  同一レイヤー内で前面へ: "Bring forward in layer",
  同一レイヤー内で背面へ: "Send backward in layer",
  アニメーション追加: "Add animation",
  "シンボル複製/追加": "Duplicate / add symbol",
  追加するAtlasパーツ: "Add atlas sprite",
  選択したパーツを配置: "Place selected sprite",
  レイヤー追加: "Add layer",
  "パーツ切り抜き / ZIPダウンロード": "Extract sprites / ZIP download",
  すべて選択: "Select all",
  選択パーツをZIP保存: "Export selected sprites as ZIP",
  単体PNG保存: "Export single PNG",
  選択パーツをPNG保存: "Export selected sprite PNG",
  保存と編集について: "Saving and editing",
  元に戻す: "Undo",
  やり直す: "Redo",
  "XMLとPNGを選択してください。": "Select XML and PNG files.",
};
Object.assign(dictionary, {
  "ワークスペースを選択してください。": "Choose a workspace.",
  "編集するツールを選択してください。": "Choose an editing tool.",
  "今後、仲間のツールと統合予定": "More tools will be integrated later",
  "← メインメニューへ": "← Main menu",
  読み込む: "Load",
  元形式のJSONを保存: "Export original JSON",
  拡大率: "Zoom",
  "Symbol ビューア（初期対応）": "Symbol viewer (early support)",
  "Symbol形式の3ファイルを選択してください。": "Select the three Symbol-format files.",
  Symbolとレイヤー: "Symbols and layers",
  表示するSymbol: "Symbol to display",
  "FrameLabel エディタ": "FrameLabel editor",
  "Animation.json を選択": "Select Animation.json",
  "Animation.json 保存": "Export Animation.json",
  "ラベルタイムライン（タップしてフレームを選択）": "Label timeline (tap to select a frame)",
  現在のフレームを指定: "Set current frame",
  ラベル一覧: "Label list",
  開始フレーム: "Start frame",
  ラベル名: "Label name",
  "追加 / 更新": "Add / update",
  ラベルを削除: "Delete label",
  フレームへ移動: "Go to frame",
  選択レイヤーを削除: "Delete selected layer",
  "読み込み後にパーツが表示されます。": "Parts appear after loading.",
  "スプライトを選択...": "Select a sprite...",
  "追加するパーツをリストから選択してください。": "Select a part from the list.",
  "PNG・spritemap JSON・Animation JSONを選択してください。":
    "Select PNG, spritemap JSON and Animation JSON.",
  "XMLとPNGを選択してください。": "Select XML and PNG.",
  選択解除: "Clear selection",
  "回転角度 (°、左回転はマイナス)": "Rotation angle (°, negative = counterclockwise)",
  指定角度だけ回転: "Rotate by angle",
  "パーツ切り抜き / ZIPダウンロード": "Extract sprites / download ZIP",
  "Character Editor / その他は今後統合": "Character Editor / more tools coming soon",
  "V-Slice キャラクター / Offset": "V-Slice Character / Offset",
  "固定した中心を使用（表示のみ）": "Use fixed center (preview only)",
  フレーム: "Frame",
  ズーム: "Zoom",
  編集するレイヤー: "Layer to edit",
  アトラス画像: "Atlas image",
  読み込み: "Load",
  XMLを保存: "Export XML",
  PNGを保存: "Export PNG",
  編集範囲: "Edit scope",
  Prefix全体: "Entire prefix",
  現在のフレームのみ: "Current frame",
  移動を適用: "Apply move",
  "スプライト選択・Prefix編集": "Sprite selection / Prefix editing",
  現在のPrefixを全選択: "Select current prefix",
  全選択: "Select all",
  選択したスプライトを削除: "Delete selected sprites",
  選択スプライトを複製: "Duplicate selected sprites",
  現在のPrefixを複製: "Duplicate current prefix",
  選択スプライトの新しいPrefix名: "New prefix for selected sprites",
  Prefix名を変更: "Rename prefix",
  選択分を0000から連番: "Renumber selected from 0000",
  アニメーションの管理: "Animation management",
  現在のPrefixを削除: "Delete current prefix",
  "統合するXML + PNG": "XML + PNG to merge",
  アトラスに統合: "Merge into atlas",
});
// 追加分2: Character Editor 関連
Object.assign(dictionary, {
  "検証済みSparrow座標モデル: アニメーションoffsetの＋は左・上。全体offsetの＋は右・下。scaleもOffsetに適用し、フレーム切替時に原点を再計算しません。":
    "Verified Sparrow coordinates: positive animation offsets move left/up; positive global offsets move right/down. Scale also affects offsets, and the origin stays fixed across frames.",
  "① character.json（最初に読み込む）": "① character.json (load first)",
  JSONを解析して必要なアトラスを検出: "Analyze JSON and detect required atlases",
  "Character JSONを解析すると、assetPathごとにアップロード欄が表示されます。":
    "Analyze Character JSON to generate upload fields for each assetPath.",
  "Character JSONを読み込むと必要なアトラスが表示されます。":
    "Load Character JSON to display required atlases.",
  "assetPathが見つかりません。Character JSONを確認してください。":
    "No assetPath found. Check the Character JSON.",
  "各assetPathにPNGとXML、またはPNG・spritemap JSON・Animation.jsonを登録します。登録したファイルは端末内でのみ処理されます。":
    "For each assetPath, provide PNG + XML or PNG + spritemap JSON + Animation.json. Files are processed locally.",
  "JSONを解析 / 再読み込み": "Analyze JSON / reload",
  "character.json 保存": "Export character.json",
  "JSON最適化（空白・改行を削除）": "Compact JSON (remove whitespace)",
  "標準では軽量な1行JSONで保存します。チェックを外すと読みやすい整形JSONになります。データの値や未編集項目は削除しません。":
    "By default, export compact one-line JSON. Uncheck for readable formatted JSON. Values and untouched properties are preserved.",
  プレビュー方式: "Preview format",
  自動判別: "Auto detect",
  "character.json と画像・アトラス定義を選択してください。":
    "Select character.json and the required atlas files.",
  キャラクター全体: "Character settings",
  "キャラクター名 (name)": "Character name (name)",
  制作者名: "Creator name",
  基本情報を適用: "Apply metadata",
  "空欄の generatedBy は未指定として削除します":
    "An empty generatedBy field removes that property",
  全体オフセットを適用: "Apply global offset",
  アニメーション設定: "Animation settings",
  アニメーション: "Animation",
  "＋ アニメーション追加": "＋ Add animation",
  名前変更: "Rename",
  削除: "Delete",
  "オフセットを 0, 0 に": "Reset offset to 0, 0",
  "↶ 戻す": "↶ Undo",
  "↷ やり直す": "↷ Redo",
  "アニメーション名 / Prefix": "Animation name / Prefix",
  "未指定（既存値を維持）": "Unspecified (keep existing value)",
  "frameIndices（カンマ区切り、空欄は未指定）":
    "frameIndices (comma-separated; empty = unspecified)",
  アニメーション設定を適用: "Apply animation settings",
  "ドラッグ右→Offset X減少、ドラッグ下→Offset Y減少。正のオフセットは左・上へ動きます。元の character.json の未編集プロパティは維持します。プレビューの十字はキャラクターの足元基準です。":
    "Drag right to decrease Offset X; drag down to decrease Offset Y. Positive offsets move left/up. Untouched character.json properties are preserved. The crosshair marks the character's feet.",
  "○ 未登録": "○ Not registered",
  "✓ 登録済み": "✓ Registered",
  PNG: "PNG",
  "XML / spritemap JSON": "XML / spritemap JSON",
  "Animation.json（新旧AnimateAtlas対応）": "Animation.json (modern / legacy AnimateAtlas)",
  "このアトラスを登録 / 更新": "Register / update this atlas",
  アトラスを登録しました: "Atlas registered",
  ラベルを保存しました: "Label saved",
  ラベルを削除しました: "Label deleted",
  キャラクター名は空欄にできません: "Character name cannot be empty",
  "キャラクター全体のオフセットを適用しました。": "Global character offset applied.",
  必要なアトラス: "Required atlases",
  "セット（重複除外）": "sets (duplicates removed)",
  登録済み: "Registered",
  未登録: "Not registered",
  すべてのファイルを選択してください: "Select all required files",
  アトラス: "Atlas",
});

// 追加分3: Character Editor 3.0（全画面プレビュー + Hud）
Object.assign(dictionary, {
  "V-Slice Character Editor 3.0": "V-Slice Character Editor 3.0",
  "プレビューをドラッグ、または矢印キーで動かせます（Shiftで10、Altで0.1刻み）。ドラッグ右→Offset X減少、ドラッグ下→Offset Y減少。正のオフセットは左・上へ動きます。":
    "Drag the preview or use the arrow keys (Shift = 10, Alt = 0.1). Drag right → Offset X decreases, drag down → Offset Y decreases. Positive offsets move left / up.",
  "↶ 戻す": "↶ Undo",
  "↷ やり直す": "↷ Redo",
  "元に戻す (Ctrl+Z)": "Undo (Ctrl+Z)",
  "やり直す (Ctrl+Y)": "Redo (Ctrl+Y)",
  "ズーム（ホイールでも可）": "Zoom (mouse wheel also works)",
  "キャラ全体を画面に収める (F)": "Fit the character in view (F)",
  "ズーム100%・原点を中央へ": "Reset zoom to 100% and recenter the origin",
  "左ドラッグでビューを動かす（Space長押し / 中・右ドラッグでも可）": "Left-drag moves the view (or hold Space / middle- or right-drag)",
  "フレームの枠を表示": "Show the frame box",
  "Hud の表示 / 非表示 (H)": "Show / hide HUD (H)",
  "ズームイン": "Zoom in",
  "ズームアウト": "Zoom out",
});

// ============================================================
// 2. 数字を含む文言の翻訳
// ============================================================
// [正規表現, 変換関数] の組。辞書に完全一致しない、数字入りの文言（例「必要なアトラス: 3 セット」）用
const dynamicTranslations = [
  [
    /^必要なアトラス:\s*(\d+)\s*セット（重複除外）$/,
    (m) => `Required atlases: ${m[1]} sets (deduplicated)`,
  ],
  [/^✓ 登録済み$/, () => "✓ Registered"],
  [/^○ 未登録$/, () => "○ Not registered"],
];

// ============================================================
// 3. 変換の仕組み
// ============================================================
// originals       : テキストノード → 元の日本語（英語表示から日本語へ戻せるように保存）
// currentLanguage : "ja" | "en"
// ignored         : 翻訳しない要素（script・style・入力欄・code など）
const originals = new WeakMap();
let currentLanguage = "ja";
const ignored = 'script,style,textarea,code,pre,[contenteditable="true"]';
// テキストノード1つを現在の言語に合わせる。'en' なら辞書で置き換え、'ja' なら元の日本語に戻す。
// 英語表示中にエディタが新しい日本語メッセージを書いた場合は、その日本語を新しい「元の文言」として扱い直す。
function localizeText(node) {
  if (!node.parentElement || node.parentElement.closest(ignored)) return;
  const now = node.nodeValue;
  if (!originals.has(node)) originals.set(node, now);
  let raw = originals.get(node);
  // When an editor rewrites a status message, treat the new Japanese text as the source.
  if (currentLanguage === "en" && now !== raw && /[ぁ-んァ-ン一-龯]/.test(now)) {
    raw = now;
    originals.set(node, raw);
  }
  const trim = raw.trim();
  if (!trim) return;
  let replacement = dictionary[trim];
  if (replacement === undefined) {
    for (const [pattern, fn] of dynamicTranslations) {
      const match = trim.match(pattern);
      if (match) {
        replacement = fn(match);
        break;
      }
    }
  }
  const desired =
    currentLanguage === "en" && replacement !== undefined ? raw.replace(trim, replacement) : raw;
  if (node.nodeValue !== desired) node.nodeValue = desired;
}
// 要素の属性などを翻訳する:
//   (1) data-ja / data-en を持つ要素はそちらを使う  (2) placeholder  (3) title（日本語を含むもの）
//   元の値は data-original-placeholder / data-original-title に退避しておく。
function localizeElement(el) {
  if (el.matches?.("[data-ja][data-en]")) {
    const wanted = el.dataset[currentLanguage];
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (node) {
      if (node.nodeValue !== wanted) node.nodeValue = wanted;
    } else if (!el.children.length && el.textContent !== wanted) el.textContent = wanted;
  }
  if (el.matches?.("[placeholder]")) {
    if (!el.hasAttribute("data-original-placeholder"))
      el.setAttribute("data-original-placeholder", el.getAttribute("placeholder"));
    const orig = el.getAttribute("data-original-placeholder");
    const desired = currentLanguage === "en" ? dictionary[orig] || orig : orig;
    if (el.getAttribute("placeholder") !== desired) el.setAttribute("placeholder", desired);
  }
  if (el.matches?.("[title]") && /[ぁ-んァ-ン一-龯]/.test(el.getAttribute("title"))) {
    if (!el.hasAttribute("data-original-title"))
      el.setAttribute("data-original-title", el.getAttribute("title"));
    const orig = el.getAttribute("data-original-title");
    const desired = currentLanguage === "en" ? dictionary[orig] || orig : orig;
    if (el.getAttribute("title") !== desired) el.setAttribute("title", desired);
  }
}
// ノードとその子孫すべてに localizeText / localizeElement を適用する
function localizeTree(root) {
  if (root.nodeType === 3) {
    localizeText(root);
    return;
  }
  if (root.nodeType !== 1 || root.matches(ignored)) return;
  localizeElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) localizeText(node);
    else if (!node.matches(ignored)) localizeElement(node);
  }
}
// ============================================================
// 4. I18n クラス（言語の切り替えと、画面の変化の監視）
// ============================================================
// app.i18n として使う。画面側は何もしなくても、DOM に追加された日本語は自動で翻訳される。
//   i18n.lang                … いまの言語 "ja" | "en"
//   i18n.setLanguage("en")   … 切り替える（"language-changed" イベントを発火 → HUD や Contributors が反応）
//   i18n.start()             … 監視を始め、前回選んだ言語を復元する（main.js が HUD を作ったあとに1回だけ呼ぶ）
export class I18n {
  constructor(app) {
    this.app = app;
  }

  get lang() {
    return currentLanguage;
  }

  // 言語を切り替える: html の lang 属性 → 画面全体の翻訳 → イベント発火 → localStorage（studioLanguage）に保存
  setLanguage(lang) {
    currentLanguage = lang === "en" ? "en" : "ja";
    document.documentElement.lang = currentLanguage;
    localizeTree(document.body);
    this.app.events.emit("language-changed", currentLanguage);
    try {
      localStorage.setItem("studioLanguage", currentLanguage);
    } catch (e) {}
  }

  // MutationObserver で、テキストの書き換えやノードの追加を監視し、変わった部分だけ翻訳する。
  // pending は、1回の更新で何度も処理が走らないよう、microtask に1回へまとめるための印。
  // （画面 State を作って DOM に挿入すると、ここが自動で拾って翻訳してくれる）
  start() {
    let pending = false;
    const observer = new MutationObserver((records) => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        for (const record of records) {
          if (record.type === "characterData") localizeText(record.target);
          else for (const node of record.addedNodes) localizeTree(node);
        }
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    // 起動時の言語: 前回選んだもの（localStorage）。保存できない環境では日本語
    let stored = "ja";
    try {
      stored = localStorage.getItem("studioLanguage") || "ja";
    } catch (e) {}
    this.setLanguage(stored);
  }
}
