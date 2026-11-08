/* ============================================================
   animate/template.js — animate 画面の HTML
   ------------------------------------------------------------
   Haxe でいう「画面のレイアウト定義（.xml / UI の組み立て）」に相当。
   JS では、バッククォート ` ` で囲んだ「テンプレートリテラル」に HTML をそのまま書ける。
   （複数行OK。中で ${...} と書くと JS の式を埋め込めるが、ここでは使っていない）
   State クラス側が `static template = template` として受け取り、画面に挿入する。
   ============================================================ */
export const template = `
    <main id="animateWorkspace">
      <section class="panel studio-preview-panel">
        <details class="studio-files">
          <summary
            data-ja="📁 ファイル・読み込み・書き出し"
            data-en="📁 Files, import & export"
          >
            📁 ファイル・読み込み・書き出し
          </summary>
          <div class="studio-file-content">
            <label>アトラス画像 (PNG)</label
            ><input id="png" type="file" accept="image/png,image/webp" /><label
              >spritemap JSON</label
            ><input
              id="mapfile"
              type="file"
              accept=".json,application/json"
            /><label>Animation JSON</label
            ><input
              id="animfile"
              type="file"
              accept=".json,application/json"
            /><label>追加するパーツ画像 (PNG/WebP)</label
            ><input
              id="addpngfiles"
              type="file"
              accept="image/png,image/webp"
              multiple
            /><label>パーツZIP (atlas_parts/*.png + atlas_manifest.json)</label
            ><input id="zipfile" type="file" accept=".zip,application/zip" />
            <div class="row">
              <button id="restorezip" class="primary">
                ZIPから復元 / 一括読み込み
              </button>
            </div>
            <div class="row" style="margin-top: 8px">
              <button id="importpng" class="primary">
                PNG追加・アトラス再構築
              </button>
            </div>
            <div class="row" style="margin-top: 10px">
              <button id="load" class="primary">読み込み / 更新</button
              ><button id="export">Animation.json保存</button>
            </div>
            <div class="row" style="margin-top: 8px">
              <button id="exportmap">spritemap JSON保存 (最小化)</button
              ><button id="exportpng">アトラスPNG保存</button>
            </div>
          </div>
        </details>
        <div class="studio-section-heading">
          <h2 data-ja="プレビュー" data-en="Preview">プレビュー</h2>
          <span
            class="studio-section-note"
            data-ja="タッチでパーツを移動"
            data-en="Drag to move elements"
            >タッチでパーツを移動</span
          >
        </div>
        <div class="studio-canvas-wrap"><canvas id="stage"></canvas></div>
        <div class="row studio-transport" style="margin-top: 8px">
          <button id="play">▶ 再生</button><button id="prev">◀ 1F</button
          ><button id="next">1F ▶</button><button id="zoomout">− 縮小</button
          ><button id="zoomin">＋ 拡大</button
          ><button id="fit">全体表示</button>
        </div>
        <details class="studio-display-options">
          <summary
            data-ja="表示・再生設定"
            data-en="Display & playback settings"
          >
            表示・再生設定
          </summary>
          <div class="studio-option-content">
            <label style="display: flex; align-items: center; gap: 8px"
              ><input type="checkbox" id="autoCenter" checked />
              固定した中心を使用（表示のみ）
              <button type="button" id="recenter">中央に合わせる</button></label
            ><label>アニメーション / シンボル</label
            ><select id="symbol"></select>
            <div class="row">
              <div>
                <label>フレーム</label
                ><input id="frame" type="number" value="0" min="0" />
              </div>
              <div>
                <label>FPS</label
                ><input id="fps" type="number" value="24" min="1" max="120" />
              </div>
              <div>
                <label>ズーム</label
                ><input
                  id="zoom"
                  type="number"
                  value="3"
                  min=".1"
                  max="16"
                  step=".25"
                />
              </div>
            </div>
          </div>
        </details>
        <div class="studio-section-heading">
          <h2 data-ja="タイムライン" data-en="Timeline">タイムライン</h2>
        </div>
        <input id="timeline" type="range" min="0" max="20" value="0" />
        <div class="row modern-only" style="margin-top: 8px">
          <div>
            <label>編集するレイヤー</label
            ><select id="keyLayer"></select>
          </div>
        </div>
        <div class="row modern-only" style="margin-top: 8px">
          <button id="keyCopy" class="primary">現在位置に複製</button
          ><button id="keyBlank">空のキーフレーム（非表示）</button
          ><button id="keyDelete">キーフレーム削除</button
          ><button id="keyExtend">最後のキーを末尾まで延長</button>
        </div>
        <div class="tiny modern-only" style="margin-top: 8px">
          ◆
          キーフレームをタップして移動。横スクロール対応。複製は直前のパーツを引き継ぎ、次のキーまたはタイムライン末尾まで表示します。空のキーフレームはそのレイヤーのパーツを非表示にします。
        </div>

        <div
          id="keyStrip"
          class="modern-only"
          style="
            display: flex;
            gap: 3px;
            overflow-x: auto;
            padding: 8px 2px;
            min-height: 54px;
          "
        ></div>
        <div id="status">
          PNG・spritemap JSON・Animation JSONを選択してください。
        </div>
      </section>
      <section class="panel modern-only studio-inspector">
        <h2 data-ja="要素・レイヤー編集" data-en="Elements & layers">
          要素・レイヤー編集
        </h2>
        <h3
          class="studio-subheading"
          data-ja="現在のフレーム"
          data-en="Current frame"
        >
          現在のフレーム
        </h3>
        <div class="tiny">
          パーツを一覧で選択してからプレビューをドラッグすると、直接位置を調整できます。追加PNGはアトラスへ組み込んでspritemapも更新します。
        </div>
        <div
          id="symbolNav"
          class="row"
          style="margin-top: 8px; gap: 6px; flex-wrap: wrap"
        ></div>
        <div id="layers" style="margin-top: 8px">
          読み込み後にパーツが表示されます。
        </div>
        <div class="row" style="margin-top: 8px">
          <button
            id="unlink"
            class="primary"
            data-ja="選択パーツをフレームから削除"
            data-en="Remove selected instance from frame"
          >
            選択パーツをフレームから削除
          </button>
        </div>
        <div
          class="tiny"
          data-ja="この操作では元のAtlas画像は削除されません。"
          data-en="This does not delete the source image from the atlas."
        >
          この操作では元のAtlas画像は削除されません。
        </div>
        <div class="tiny" style="margin-top: 6px">
          解除は現在のフレームに置かれた要素だけを対象にします。Atlas削除は全アニメーション・全シンボルの参照を確認し、未使用の場合のみ再配置して削除します。
        </div>
        <details class="studio-inspector-group" open>
          <summary
            data-ja="位置・回転・拡大縮小"
            data-en="Position, rotation & scale"
          >
            位置・回転・拡大縮小
          </summary>
          <div class="studio-group-body">
            <div class="tiny">2D transform [a, b, c, d, tx, ty] (MX / M3D)</div>
            <div class="fields" style="margin-top: 10px">
              <label>a<input id="m0" type="number" step=".001" /></label
              ><label>b<input id="m1" type="number" step=".001" /></label
              ><label>c<input id="m2" type="number" step=".001" /></label
              ><label>d<input id="m3" type="number" step=".001" /></label
              ><label>tx<input id="m4" type="number" step=".1" /></label
              ><label>ty<input id="m5" type="number" step=".1" /></label>
            </div>
            <div class="row" style="margin-top: 10px">
              <label
                >回転角度 (°、左回転はマイナス)<input
                  id="rotateAngle"
                  type="number"
                  value="0"
                  step="1" /></label
              ><button id="rotateApply" class="primary">
                指定角度だけ回転
              </button>
            </div>
            <div class="row" style="margin-top: 10px">
              <button id="apply" class="primary">変換を適用</button
              ><button id="reset">選択解除</button>
            </div>
            <div class="row" style="margin-top: 8px">
              <button id="front" class="primary">レイヤーを前面へ ▲</button
              ><button id="back">レイヤーを背面へ ▼</button>
            </div>
            <div class="row" style="margin-top: 8px">
              <button id="elemfront">同一レイヤー内で前面へ</button
              ><button id="elemback">同一レイヤー内で背面へ</button>
            </div>
          </div>
        </details>
        <details class="studio-inspector-group">
          <summary
            data-ja="レイヤー・要素の追加"
            data-en="Add layers & elements"
          >
            レイヤー・要素の追加
          </summary>
          <div class="studio-group-body">
            <div class="row" style="margin-top: 8px">
              <button id="addanim" class="primary">アニメーション追加</button
              ><button id="addsymbol">シンボル複製/追加</button
              ><button
                id="newSymbol"
                data-ja="空のSymbolを追加"
                data-en="Add empty Symbol"
              >
                空のSymbolを追加</button
              ><button
                id="deleteSymbol"
                data-ja="選択Symbolを削除"
                data-en="Delete selected Symbol"
              >
                選択Symbolを削除
              </button>
            </div>
            <label data-ja="追加するAtlasパーツ" data-en="Atlas sprite to place"
              >追加するAtlasパーツ</label
            ><label data-ja="配置先レイヤー" data-en="Target layer"
              >配置先レイヤー</label
            ><select id="partTargetLayer"></select
            ><select id="addSprite">
              <option value="">スプライトを選択...</option>
            </select>
            <div id="addSpriteInfo" class="tiny">
              追加するパーツをリストから選択してください。
            </div>
            <div id="addSpriteGrid" class="sprite-grid"></div>
            <div class="row" style="margin-top: 8px">
              <button
                id="addpart"
                class="primary"
                data-ja="選択フレームにパーツを追加"
                data-en="Add sprite to current frame"
              >
                選択フレームにパーツを追加</button
              ><button id="addlayer">レイヤー追加</button
              ><button id="deleteLayer">選択レイヤーを削除</button>
            </div>
          </div>
        </details>
        <details class="studio-inspector-group">
          <summary
            data-ja="パーツ切り抜き / ZIPダウンロード"
            data-en="Extract parts / ZIP download"
          >
            パーツ切り抜き / ZIPダウンロード
          </summary>
          <div class="tiny">
            画像を見ながら複数選択。編集したPNGは同じZIPのmanifestと一緒に復元できます。
          </div>
          <div class="row">
            <button id="selectAllSprites">すべて選択</button
            ><button id="selectNoSprites">選択解除</button>
          </div>
          <div id="extractGrid" class="sprite-grid"></div>
          <div class="row">
            <button id="extractZip" class="primary">選択パーツをZIP保存</button>
          </div>
          <label
            data-ja="Atlas画像の管理・単体PNG保存"
            data-en="Manage atlas sprites / Export PNG"
            >Atlas画像の管理・単体PNG保存</label
          ><select id="sprite"></select>
          <div class="row" style="margin-top: 8px">
            <button id="extract">選択パーツをPNG保存</button
            ><button
              id="deleteSprite"
              data-ja="未使用パーツをAtlasから削除"
              data-en="Delete unused sprite from atlas"
            >
              未使用パーツをAtlasから削除
            </button>
          </div>
          <div
            class="tiny"
            data-ja="Atlasから削除するとPNGとspritemap JSONを再構築します。使用中のパーツと、削除後も残る回転済みパーツは保護されます。"
            data-en="Deleting from atlas rebuilds PNG and spritemap JSON. Referenced sprites and remaining rotated sprites are protected."
          >
            Atlasから削除するとPNGとspritemap
            JSONを再構築します。使用中のパーツと、削除後も残る回転済みパーツは保護されます。
          </div>
        </details>
        <details class="studio-inspector-group">
          <summary
            data-ja="保存と編集について"
            data-en="About saving and editing"
          >
            保存と編集について
          </summary>
          <div class="tiny">
            編集内容はブラウザ内のデータに反映されます。描画順はレイヤー順を入れ替えて変更します（先頭のレイヤーほど前面）。同一レイヤー内では要素順も変更できます。変更後はAnimation
            JSONを保存してゲーム内で確認してください。spritemap
            JSON・アトラスPNGはそれぞれ別々に保存できます。元ファイルは直接上書きしません。シンボル追加は選択中シンボルの複製、アニメーション追加はメインタイムライン末尾への新規ラベル追加です。プレビューで選択パーツをドラッグして位置調整できます。追加PNGを組み込むと、PNGとspritemap
            JSONを再構築して保存します。ZIP復元はPython版atlas_manifest.jsonの元座標を使用します。回転済みスプライトを含むアトラスは安全のため再構築を中止します。
          </div>
        </details>
      </section>
      <details id="anFrameLabels" class="panel" style="margin: 12px 0" open>
        <summary
          data-ja="FrameLabelの編集（AnimateAtlas統合）"
          data-en="Edit FrameLabels (AnimateAtlas)"
        >
          FrameLabelの編集（AnimateAtlas統合）
        </summary>
        <p
          class="tiny"
          data-ja="Animation.jsonのFR.Nを編集します。変更は通常のAnimation.json保存に含まれ、Undo/Redoも共有します。"
          data-en="Edit FR.N labels in Animation.json. Changes are included in the normal Animation.json export and share Undo/Redo."
        >
          Animation.jsonのFR.Nを編集します。変更は通常のAnimation.json保存に含まれ、Undo/Redoも共有します。
        </p>
        <div class="row">
          <label data-ja="ラベル一覧" data-en="Labels"
            >ラベル一覧<select
              id="anLabelList"
              style="min-width: 200px"
            ></select></label
          ><button
            id="anLabelJump"
            data-ja="選択位置へ移動"
            data-en="Jump to label"
          >
            選択位置へ移動
          </button>
        </div>
        <div class="row">
          <label data-ja="開始フレーム" data-en="Start frame"
            >開始フレーム<input
              id="anLabelFrame"
              type="number"
              min="0"
              value="0" /></label
          ><label data-ja="ラベル名" data-en="Label name"
            >ラベル名<input id="anLabelName" type="text" placeholder="Idle"
          /></label>
        </div>
        <div class="row">
          <button
            id="anLabelCurrent"
            data-ja="現在フレームを使用"
            data-en="Use current frame"
          >
            現在フレームを使用</button
          ><button
            id="anLabelSave"
            class="primary"
            data-ja="追加 / 更新"
            data-en="Add / Update"
          >
            追加 / 更新</button
          ><button
            id="anLabelDelete"
            data-ja="選択ラベルを削除"
            data-en="Delete selected label"
          >
            選択ラベルを削除
          </button>
        </div>
        <div id="anLabelStatus" class="tiny"></div>
      </details>
      <details
        id="legacyEditPanel"
        class="panel studio-legacy-panel"
        style="margin: 12px 0"
        hidden
        open
      >
        <summary data-ja="旧形式Symbolの編集" data-en="Edit legacy Symbols">
          旧形式Symbolの編集
        </summary>
        <p
          class="tiny"
          data-ja="Fakeout形式のレイヤーとパーツを編集します。元のJSON構造を保持し、専用ボタンで書き出します。"
          data-en="Edit layers and parts in legacy Fakeout format. The original JSON schema is preserved on export."
        >
          Fakeout形式のレイヤーとパーツを編集します。元のJSON構造を保持し、専用ボタンで書き出します。
        </p>
        <div class="row">
          <label data-ja="レイヤー" data-en="Layer"
            >レイヤー<select id="legacyLayer"></select></label
          ><label data-ja="要素" data-en="Element"
            >要素<select id="legacyElement"></select
          ></label>
        </div>
        <details class="studio-inspector-group" open>
          <summary data-ja="位置・変形" data-en="Position & transform">
            位置・変形
          </summary>
          <div class="studio-group-body">
            <h3
              data-ja="選択要素の描画位置"
              data-en="Selected element position"
            >
              選択要素の描画位置
            </h3>
            <p
              class="tiny"
              data-ja="レイヤーではなく選択した要素だけを移動します。X/Yを入力して適用するか、プレビューをドラッグしてください。変更は現在のキーフレームに保存されます。"
              data-en="Move only the selected element, not the whole layer. Enter X/Y and apply, or drag on the preview. Changes are stored in the current keyframe."
            >
              レイヤーではなく選択した要素だけを移動します。X/Yを入力して適用するか、プレビューをドラッグしてください。変更は現在のキーフレームに保存されます。
            </p>
            <div class="row">
              <label data-ja="X座標" data-en="X position"
                >X座標<input id="legacyPosX" type="number" step="0.1" /></label
              ><label data-ja="Y座標" data-en="Y position"
                >Y座標<input id="legacyPosY" type="number" step="0.1" /></label
              ><button
                id="legacyPositionApply"
                class="primary"
                data-ja="位置を適用"
                data-en="Apply position"
              >
                位置を適用
              </button>
            </div>
            <div class="row">
              <button id="legacyNudgeLeft" data-ja="← 左へ1" data-en="← Left 1">
                ← 左へ1</button
              ><button
                id="legacyNudgeRight"
                data-ja="右へ1 →"
                data-en="Right 1 →"
              >
                右へ1 →</button
              ><button id="legacyNudgeUp" data-ja="↑ 上へ1" data-en="↑ Up 1">
                ↑ 上へ1</button
              ><button
                id="legacyNudgeDown"
                data-ja="下へ1 ↓"
                data-en="Down 1 ↓"
              >
                下へ1 ↓
              </button>
            </div>
            <div class="row legacy-matrix">
              <label>a<input id="legacyM0" type="number" step="any" /></label
              ><label>b<input id="legacyM1" type="number" step="any" /></label
              ><label>c<input id="legacyM2" type="number" step="any" /></label
              ><label>d<input id="legacyM3" type="number" step="any" /></label
              ><label>tx<input id="legacyM4" type="number" step="any" /></label
              ><label>ty<input id="legacyM5" type="number" step="any" /></label>
            </div>
            <p
              class="tiny legacy-help"
              data-ja="Symbolとレイヤーを選び、要素の変形行列を変更して「変形を適用」を押します。選択中フレームのキーに反映されます。"
              data-en="Select a symbol, layer and element, change its transform matrix, then press Apply transform. This edits the keyframe at the current time."
            >
              Symbolとレイヤーを選び、要素の変形行列を変更して「変形を適用」を押します。選択中フレームのキーに反映されます。
            </p>
            <div class="row">
              <button
                id="legacyApply"
                class="primary"
                data-ja="変形を適用"
                data-en="Apply transform"
              >
                変形を適用</button
              ><button
                id="legacyUp"
                data-ja="レイヤーを前面へ"
                data-en="Move layer forward"
              >
                レイヤーを前面へ</button
              ><button
                id="legacyDown"
                data-ja="レイヤーを背面へ"
                data-en="Move layer backward"
              >
                レイヤーを背面へ
              </button>
            </div>
            <div class="row">
              <label
                data-ja="レイヤーの重なり順（0が最前面）"
                data-en="Layer order (0 = front)"
                >レイヤーの重なり順（0が最前面）<input
                  id="legacyZ"
                  type="number"
                  min="0"
                  step="1" /></label
              ><button
                id="legacySetZ"
                data-ja="順序を適用"
                data-en="Apply order"
              >
                順序を適用
              </button>
            </div>
          </div>
        </details>
        <details class="studio-inspector-group">
          <summary data-ja="フレーム編集" data-en="Frame editing">
            フレーム編集
          </summary>
          <div class="studio-group-body">
            <h3 data-ja="フレーム編集" data-en="Frame editing">フレーム編集</h3>
            <p
              class="tiny"
              data-ja="現在のフレーム位置でキーフレームを分割・追加します。操作対象は選択中のレイヤーです。"
              data-en="Split or add a keyframe at the current frame. Operations affect the selected layer."
            >
              現在のフレーム位置でキーフレームを分割・追加します。操作対象は選択中のレイヤーです。
            </p>
            <div class="row">
              <button
                id="legacyDuplicate"
                class="primary"
                data-ja="現在の表示を複製"
                data-en="Duplicate visible frame"
              >
                現在の表示を複製</button
              ><button
                id="legacyBlank"
                data-ja="空のフレームを追加"
                data-en="Add blank frame"
              >
                空のフレームを追加</button
              ><button
                id="legacyDeleteFrame"
                data-ja="現在のキーを削除"
                data-en="Delete current key"
              >
                現在のキーを削除
              </button>
            </div>
            <div class="row">
              <label data-ja="キーの開始フレーム" data-en="Key start frame"
                >キーの開始フレーム<input
                  id="legacyKeyStart"
                  type="number"
                  min="0"
                  step="1"
                  readonly /></label
              ><label
                data-ja="キーの長さ（フレーム）"
                data-en="Key duration (frames)"
                >キーの長さ（フレーム）<input
                  id="legacyKeyDuration"
                  type="number"
                  min="1"
                  step="1" /></label
              ><button
                id="legacySetDuration"
                data-ja="長さを適用"
                data-en="Apply duration"
              >
                長さを適用
              </button>
            </div>
          </div>
        </details>
        <details class="studio-inspector-group">
          <summary
            data-ja="レイヤー・重なり順"
            data-en="Layers & stacking order"
          >
            レイヤー・重なり順
          </summary>
          <div class="studio-group-body">
            <h3 data-ja="レイヤー編集" data-en="Layer editing">レイヤー編集</h3>
            <div class="row">
              <button
                id="legacyAddLayer"
                data-ja="レイヤー追加"
                data-en="Add layer"
              >
                レイヤー追加</button
              ><button
                id="legacyRemoveLayer"
                data-ja="選択レイヤー削除"
                data-en="Delete selected layer"
              >
                選択レイヤー削除</button
              ><button
                id="legacyElementFront"
                data-ja="要素を前面へ"
                data-en="Move element forward"
              >
                要素を前面へ</button
              ><button
                id="legacyElementBack"
                data-ja="要素を背面へ"
                data-en="Move element backward"
              >
                要素を背面へ
              </button>
            </div>
          </div>
        </details>
        <div class="row studio-save-row">
          <button
            id="legacySave"
            class="primary"
            data-ja="旧形式Animation.jsonを保存"
            data-en="Export legacy Animation.json"
          >
            旧形式Animation.jsonを保存
          </button>
        </div>
        <div class="row">
          <button
            id="legacyNewSymbol"
            data-ja="Symbolを追加"
            data-en="Add Symbol"
          >
            Symbolを追加</button
          ><button
            id="legacyCloneSymbol"
            data-ja="Symbolを複製"
            data-en="Duplicate Symbol"
          >
            Symbolを複製</button
          ><button
            id="legacyDeleteSymbol"
            data-ja="Symbolを削除"
            data-en="Delete Symbol"
          >
            Symbolを削除
          </button>
        </div>
        <div id="legacyEditStatus" class="tiny"></div>
      </details>
    </main>
`;
