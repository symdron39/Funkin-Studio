/* ============================================================
   main.js — アプリの入口（Haxe の Main.hx / FlxGame の起動に相当）
   ------------------------------------------------------------
   やることは「部品を作って、画面を登録して、最初の画面を開く」だけ。
   index.html の <script type="module" src=".../main.js"> から読み込まれる。

   フォルダの見取り図:
     core/      画面の仕組み本体（State / StateManager / App / EventBus）… どのアプリにも使える汎用部分
     states/    画面（1画面 = 1ファイル）。エディタの中身は states/<名前>/ に分けてある
     ui/        どの画面にも重なる共有パーツ（HUD）
     services/  画面に属さない機能（翻訳・自動保存・配色ラボ・未保存の警告）
     data/      データ（クレジット一覧）

   JS メモ（ES Modules）:
     ・import { X } from "./a.js"  … a.js が export しているものを使う（Haxe の import と同じ感覚）
     ・各ファイルは独立したスコープを持ち、export しないものは外から見えない
     ・<script type="module"> は自動で defer 扱い（HTML を読み終えてから実行される）
     ・http(s):// で配信されている必要がある（file:// 直開きは不可）。オフライン版は build.py が1枚にまとめる
   ============================================================ */
import { App } from "./core/App.js";
import { I18n } from "./services/i18n.js";
import { UnsavedGuard } from "./services/UnsavedGuard.js";
import { startAutosave } from "./services/Autosave.js";
import { startColorLab } from "./services/ColorLab.js";
import { startMobileFilePicker } from "./services/MobileFilePicker.js";
import { Hud } from "./ui/Hud.js";

import { HomeState } from "./states/HomeState.js";
import { RenderMenuState } from "./states/RenderMenuState.js";
import { FunkinMenuState } from "./states/FunkinMenuState.js";
import { OtherMenuState } from "./states/OtherMenuState.js";
import { ContributorsState } from "./states/ContributorsState.js";
import { AnimateEditorState } from "./states/AnimateEditorState.js";
import { SparrowEditorState } from "./states/SparrowEditorState.js";
import { CharacterEditorState } from "./states/CharacterEditorState.js";
import { StageEditorState } from "./states/StageEditorState.js";

const app = new App(document.getElementById("app"));

// 共有パーツ。作る順番に意味がある: HUD（言語ボタンを持つ）→ 翻訳の開始
app.i18n = new I18n(app);
app.hud = new Hud(app);
app.unsaved = new UnsavedGuard(app);

// 画面を登録（各クラスの static id が名前になる）
app.states.register(
  HomeState,
  RenderMenuState,
  FunkinMenuState,
  OtherMenuState,
  ContributorsState,
  AnimateEditorState,
  SparrowEditorState,
  CharacterEditorState,
  StageEditorState,
);

startColorLab();
startMobileFilePicker(); // スマホで XML / JSON が選べない問題の対策（services/MobileFilePicker.js）
startAutosave(app);
app.i18n.start(); // HUD / ColorLab の文字を翻訳し、以降の DOM 追加も監視

app.switchTo("home"); // ← FlxG.switchState(new MainMenuState()) と同じ

// デバッグ用: ブラウザの開発者コンソールから app.switchTo("sparrow") などを試せる
window.app = app;
