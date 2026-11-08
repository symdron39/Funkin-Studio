/* ============================================================
   sparrow/template.js — sparrow 画面の HTML
   ------------------------------------------------------------
   Haxe でいう「画面のレイアウト定義（.xml / UI の組み立て）」に相当。
   JS では、バッククォート ` ` で囲んだ「テンプレートリテラル」に HTML をそのまま書ける。
   （複数行OK。中で ${...} と書くと JS の式を埋め込めるが、ここでは使っていない）
   State クラス側が `static template = template` として受け取り、画面に挿入する。
   ============================================================ */
export const template = `
    <section id="sparrowWorkspace" hidden>
      <div class="panel">
        <h2 data-ja="Sparrow：XML + PNG" data-en="Sparrow: XML + PNG">
          Sparrow：XML + PNG
        </h2>
        <label data-ja="アトラス画像" data-en="Atlas image">アトラス画像</label
        ><input type="file" id="spPng" accept="image/png" />
        <label data-ja="Sparrow XML" data-en="Sparrow XML">Sparrow XML</label
        ><input type="file" id="spXml" accept=".xml,text/xml,application/xml" />
        <div class="row">
          <button id="spLoad" class="primary" data-ja="読み込み" data-en="Load">
            読み込み</button
          ><button id="spExport" data-ja="XMLを保存" data-en="Export XML">
            XMLを保存</button
          ><button id="spExportPng" data-ja="PNGを保存" data-en="Export PNG">
            PNGを保存
          </button>
        </div>
        <canvas id="spCanvas"></canvas>
        <div class="row">
          <button id="spPrev">◀</button><span id="spFrameInfo">0 / 0</span
          ><button id="spNext">▶</button
          ><button id="spPlay" data-ja="▶ 再生" data-en="▶ Play">▶ 再生</button>
        </div>
        <label data-ja="Prefix" data-en="Prefix">Prefix</label
        ><select id="spPrefix"></select>
        <label data-ja="編集範囲" data-en="Edit scope">編集範囲</label
        ><select id="spScope">
          <option value="prefix" data-ja="Prefix全体" data-en="Entire prefix">
            Prefix全体
          </option>
          <option
            value="frame"
            data-ja="現在のフレームのみ"
            data-en="Current frame only"
          >
            現在のフレームのみ
          </option>
        </select>
        <div class="row">
          <label>X<input id="spX" type="number" step="1" value="0" /></label
          ><label>Y<input id="spY" type="number" step="1" value="0" /></label
          ><button
            id="spMove"
            class="primary"
            data-ja="移動を適用"
            data-en="Apply move"
          >
            移動を適用
          </button>
        </div>
        <div
          class="tiny"
          data-ja="プレビューをドラッグしても位置を調整できます。移動はXMLのframeX/frameYに反映されます。"
          data-en="Drag the preview to move frames. Position is saved in frameX/frameY."
        >
          プレビューをドラッグしても位置を調整できます。移動はXMLのframeX/frameYに反映されます。
        </div>
        <div id="spStatus" class="tiny">XMLとPNGを選択してください。</div>
      </div>
      <div class="panel">
        <h2
          data-ja="スプライト選択・Prefix編集"
          data-en="Sprite selection & Prefix editing"
        >
          スプライト選択・Prefix編集
        </h2>
        <div hidden>
          <button id="spUndo" disabled>Undo</button
          ><button id="spRedo" disabled>Redo</button>
        </div>
        <div class="row">
          <button
            id="spSelectPrefix"
            data-ja="現在のPrefixを全選択"
            data-en="Select current prefix"
          >
            現在のPrefixを全選択</button
          ><button id="spSelectAll" data-ja="全選択" data-en="Select all">
            全選択</button
          ><button
            id="spSelectNone"
            data-ja="選択解除"
            data-en="Clear selection"
          >
            選択解除
          </button>
        </div>
        <div id="spTiles" class="spTiles"></div>
        <div id="spSelectedCount" class="tiny"></div>
        <div class="row">
          <button
            id="spDeleteSelected"
            data-ja="選択したスプライトを削除"
            data-en="Delete selected sprites"
          >
            選択したスプライトを削除
          </button>
        </div>
        <div class="row">
          <button
            id="spDuplicate"
            class="primary"
            data-ja="選択スプライトを複製"
            data-en="Duplicate selected sprites"
          >
            選択スプライトを複製</button
          ><button
            id="spDuplicatePrefix"
            data-ja="現在のPrefixを複製"
            data-en="Duplicate current prefix"
          >
            現在のPrefixを複製
          </button>
        </div>
        <p
          class="tiny"
          data-ja="複製時は画像領域を共有し、名前と位置は個別に編集できます。新しいPrefix名を入力してから複製してください。"
          data-en="Duplicates share image pixels but have independent names and offsets. Enter a new prefix before duplicating."
        >
          複製時は画像領域を共有し、名前と位置は個別に編集できます。新しいPrefix名を入力してから複製してください。
        </p>
        <label
          data-ja="選択スプライトの新しいPrefix名"
          data-en="New prefix for selected sprites"
          >選択スプライトの新しいPrefix名</label
        ><input id="spNewPrefix" placeholder="BF dance" />
        <div class="row">
          <button
            id="spRename"
            class="primary"
            data-ja="Prefix名を変更"
            data-en="Rename prefix"
          >
            Prefix名を変更</button
          ><button
            id="spRenumber"
            data-ja="選択分を0000から連番"
            data-en="Renumber from 0000"
          >
            選択分を0000から連番
          </button>
        </div>
        <h2
          style="margin-top: 20px"
          data-ja="アニメーションの管理"
          data-en="Animation management"
        >
          アニメーションの管理
        </h2>
        <div class="row">
          <button
            id="spDelete"
            data-ja="現在のPrefixを削除"
            data-en="Delete current prefix"
          >
            現在のPrefixを削除
          </button>
        </div>
        <label data-ja="統合するXML + PNG" data-en="XML + PNG to merge"
          >統合するXML + PNG</label
        ><input type="file" id="spMergeXml" accept=".xml" /><input
          type="file"
          id="spMergePng"
          accept="image/png"
        />
        <button
          id="spMerge"
          class="primary"
          data-ja="アトラスに統合"
          data-en="Merge into atlas"
        >
          アトラスに統合
        </button>
        <p
          class="tiny"
          data-ja="統合時は画像を再配置し、XMLの座標を更新します。元ファイルは上書きしません。"
          data-en="Merging repacks images and updates XML coordinates. Original files are not overwritten."
        >
          統合時は画像を再配置し、XMLの座標を更新します。元ファイルは上書きしません。
        </p>
      </div>
    </section>
`;
