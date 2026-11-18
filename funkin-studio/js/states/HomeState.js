/* ============================================================
   states/HomeState.js — ホーム画面（最初に出る画面）
   ------------------------------------------------------------
   Haxe でいう MainMenuState。ボタンを押したら別の State へ switchTo するだけの、いちばん小さな見本。
   他の画面も基本はこの形:
     ① static id / template を決める
     ② create() でボタンを配線する
   ============================================================ */
import { getIncludeOriginal, setIncludeOriginal } from "../services/ModExport.js";
import { isEnabled as isRemoteOn, setEnabled as setRemoteOn, refreshIndex, BRANCHES, getBranch, setBranch, reset as resetRemote } from "../services/FunkinAssets.js";
import { State } from "../core/State.js";

export class HomeState extends State {
  static id = "home";
  static template = `
    <div id="studioHome" role="dialog" aria-modal="true">
      <div class="welcome-inner">
        <h1>Funkin' Modding Hub</h1>
        <p class="tiny">今日は、何をしよう。</p>
        <div class="render-choices">
          <button id="homeAnimate" class="render-choice">
            <strong>Animate Editor</strong>
            <small>AnimateAtlas / Sparrow</small>
          </button>
          <button id="homeFunkin" class="render-choice">
            <strong>Funkin' Editor</strong>
            <small>Character Editor / 今後実装予定</small>
          </button>
          <button id="homeOther" class="render-choice">
            <strong>その他</strong>
            <small>注意事項や、クレジットなどが記載されています。</small>
          </button>
        </div>
        <div class="modLoader panel">
          <strong>mod を読み込む</strong>
          <small class="tiny">ここで読み込んだ mod は、すべてのエディタで共有されます（中身は必要になったときだけ読みます）。</small>
          <div class="row">
            <label class="fileBtn">zip（スマホ可）<input id="homeModZip" type="file" accept=".zip,application/zip" multiple hidden /></label>
            <label class="fileBtn stgDesktopOnly">フォルダ（PC）<input id="homeModDir" type="file" webkitdirectory multiple hidden /></label>
            <button id="homeModClear" type="button">空にする</button>
          </div>
          <label class="tiny" title="読み込んだ mod に無いキャラ・ステージ・ノートスタイル（と画像）を、FunkinCrew/Funkin.assets（GitHub）から必要な分だけ取得します。取得したものは書き出す zip には含めません"><input id="homeRemote" type="checkbox" /> mod に無い本体アセットを GitHub（Funkin.assets）から取得する</label>
          <label class="tiny" title="取得元のブランチ。main = 0.8 系の配置、preview/public-playtest = 0.9 プレビューの配置。変えると、前回取得したものを捨てて取り直します">取得するブランチ <select id="homeBranch"></select></label>
          <label class="tiny"><input id="homeModWhole" type="checkbox" /> 書き出し時に、読み込んだ元の mod 全体も zip に含める</label>
          <p id="homeModInfo" class="tiny">まだ読み込んでいません。</p>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#homeAnimate", "renderMenu");
    this.goOnClick("#homeFunkin", "funkinMenu");
    this.goOnClick("#homeOther", "otherMenu");
    const ws = this.app.workspace;
    const q = (id) => this.root.querySelector(id);
    const info = q("#homeModInfo");
    const render = () => {
      if (!ws.size) return (info.textContent = "まだ読み込んでいません。");
      const sm = ws.summary();
      info.textContent = `読み込み済み: ${ws.size} ファイル（${ws.names.join(", ") || "フォルダ"}）。ステージ ${sm.stages.length}・キャラ ${sm.characters.length}・noteStyle ${sm.noteStyles.length}・images ${sm.images}・scripts ${sm.scripts}`;
    };
    const off = this.app.events.on("workspace:changed", render);
    this.addDisposer(() => off());
    q("#homeModZip").onchange = async (e) => {
      const fs = [...e.target.files];
      e.target.value = "";
      info.textContent = "zip を開いています…";
      try {
        for (const f of fs) await ws.loadZip(f);
      } catch (err) {
        info.textContent = "zip を開けません: " + err.message;
      }
      render();
    };
    q("#homeModDir").onchange = (e) => {
      const fs = [...e.target.files];
      e.target.value = "";
      const top = fs[0]?.webkitRelativePath?.split("/")[0];
      ws.add(fs, top);
      render();
    };
    this._render = render;
    refreshIndex(); // 本体アセットの一覧を新しくする（保存はしない。失敗しても同梱の一覧で動く）
    const br = q("#homeBranch");
    for (const b of BRANCHES) br.append(new Option(b.label, b.id));
    br.value = getBranch();
    br.onchange = () => {
      setBranch(br.value);
      resetRemote(this.app.workspace); // 前回のブランチから取得したものは捨てる
      this.app.noteStyles?.dropBuiltin?.();
      refreshIndex();
    };
    q("#homeRemote").checked = isRemoteOn();
    q("#homeRemote").onchange = (e) => setRemoteOn(e.target.checked);
    q("#homeModWhole").checked = getIncludeOriginal();
    q("#homeModWhole").onchange = (e) => setIncludeOriginal(e.target.checked);
    q("#homeModClear").onclick = () => ws.clear();
    render();
  }
  onShow() {
    this._render?.();
  }
}
