/* ============================================================
   stage/template.js — Stage Editor 画面の HTML
   ------------------------------------------------------------
   Character Editor 3.0 と同じ「全画面プレビュー + Hud パネル」方式。
     ・#stgCanvas が画面いっぱい（パン / ズーム可能。ui/Viewport.js）
     ・操作はすべて .hudLayer の中の Hud。ボタンで個別に、👁（または H キー）で一括して表示/非表示（ui/HudPanels.js）
   ID はすべて "stg" で始まる（他の画面の ID と衝突しないため。getElementById は画面をまたいで全体から探す）。
   ============================================================ */
export const template = `
    <section id="stageWorkspace" class="hudWorkspace" hidden>
      <canvas id="stgCanvas"></canvas>

      <div class="hudLayer" data-all-hidden="false">
        <button id="stgHudEye" class="hudEye" type="button" data-hud-all title="Hud の表示 / 非表示 (H)" aria-label="Hud の表示 / 非表示">👁</button>

        <!-- 上のバー: パネルの切り替え・ビュー操作・選択中の情報 -->
        <div class="hudBar" data-hud-panel="bar" data-hud-always>
          <button type="button" data-hud-toggle="files" data-ja="📁 ファイル" data-en="📁 Files">📁 ファイル</button>
          <button type="button" data-hud-toggle="layers" data-ja="🗂 レイヤー" data-en="🗂 Layers">🗂 レイヤー</button>
          <button type="button" data-hud-toggle="props" data-ja="🔧 プロパティ" data-en="🔧 Properties">🔧 プロパティ</button>
          <button type="button" data-hud-toggle="stage" data-ja="🎬 ステージ" data-en="🎬 Stage">🎬 ステージ</button>
          <span class="hudSep"></span>
          <button id="stgZoomOut" type="button" title="ズームアウト">−</button>
          <input id="stgZoom" type="number" min=".05" max="16" step=".05" value="1" title="ズーム（ホイールでも可）" />
          <button id="stgZoomIn" type="button" title="ズームイン">＋</button>
          <button id="stgFit" type="button" title="すべてを画面に収める (F)" data-ja="⊡ 全体" data-en="⊡ Fit">⊡ 全体</button>
          <button id="stgResetView" type="button" title="ズーム100%・原点を中央へ" data-ja="⌖ 原点" data-en="⌖ Origin">⌖ 原点</button>
          <button id="stgPanTool" type="button" title="左ドラッグでビューを動かす（Space長押し / 中・右ドラッグでも可）" data-ja="✋ 移動" data-en="✋ Pan">✋ 移動</button>
          <span class="hudSep"></span>
          <span id="stgReadout" class="hudReadout"></span>
        </div>

        <!-- 左: ファイル・レイヤー -->
        <div class="hudDock hudDockLeft">
          <aside class="hudPanel" data-hud-panel="files">
            <h2>Stage Editor</h2>
            <div class="row">
              <button id="stgNew" type="button">新規ステージ</button>
              <button id="stgSave" class="primary" type="button">stage.json 保存</button>
            </div>
            <label>stage.json を開く<input id="stgFile" type="file" accept=".json,application/json" /></label>
            <div class="row">
              <label><input id="stgCompact" type="checkbox" /> 整形して保存（オフ=1行の軽量JSON）</label>
            </div>
            <h3>画像アセット</h3>
            <label>画像・XML・TXT・AnimateAtlas を登録（複数可）<input id="stgImages" type="file" accept="image/*,.xml,.txt,.json,text/xml,text/plain,application/json" multiple /></label>
            <label class="stgDesktopOnly">フォルダごと登録（AnimateAtlas 向け・PC）<input id="stgAtlasDir" type="file" webkitdirectory multiple /></label>
            <label class="stgDesktopOnly" title="mod のフォルダ全体を選ぶと、json とアセットが別のフォルダにあっても、assetPath から自動で探します。中身は必要になったときだけ読むので、大きなフォルダでも軽いです">mod フォルダ全体を登録（PC）<input id="stgPoolDir" type="file" webkitdirectory multiple /></label>
            <details>
              <summary>結び付けのルール</summary>
              <p class="tiny">
                propの assetPath と同じ名前（フォルダ・拡張子は無視）のPNGを選ぶと自動で結び付きます。アニメ付き（Sparrow）propは同名のXMLも必要です（PNGと一緒に選択）。まとめて複数選択できます。名前が違う画像は、一覧の「選択」で手動で結び付けられます。
              </p>
            </details>
            <div id="stgAssetList" class="stgAssetList"></div>
            <div id="stgStatus" class="tiny"></div>
          </aside>

          <aside class="hudPanel" data-hud-panel="layers">
            <h2>レイヤー</h2>
            <div class="row">
              <label class="stgFileBtn" title="画像を選んでpropを追加（ファイル名がassetPathになります）。同名のXML/TXTを一緒に選ぶとアニメ付き、Animation.json+spritemapならAnimateAtlas">＋ 画像prop<input id="stgAddImage" type="file" accept="image/*,.xml,.txt,.json,text/xml,text/plain,application/json" multiple hidden /></label>
              <button id="stgAddRect" type="button" title="単色の矩形prop">＋ 色矩形</button>
              <button id="stgDup" type="button" title="複製 (Ctrl+D)">複製</button>
              <button id="stgDel" type="button" title="削除 (Delete)">削除</button>
            </div>
            <div class="row">
              <button id="stgUp" type="button" title="zIndex を +1（手前へ）">▲ 手前へ</button>
              <button id="stgDown" type="button" title="zIndex を −1（奥へ）">▼ 奥へ</button>
            </div>
            <div id="stgLayers" class="stgLayers" role="listbox" aria-label="レイヤー"></div>
            <p class="tiny">上ほど手前。👁 は表示のみ（保存されません）。</p>
          </aside>
        </div>

        <!-- 右: プロパティ・ステージ -->
        <div class="hudDock hudDockRight">
          <aside class="hudPanel" data-hud-panel="props">
            <h2 id="stgPropsTitle">プロパティ</h2>
            <p id="stgNoSel" class="tiny">プレビューかレイヤー一覧で、propやキャラを選んでください。</p>

            <!-- prop -->
            <div id="stgPropFields" hidden>
              <label>name<input id="stgPName" type="text" placeholder="スクリプトから参照する名前（任意）" /></label>
              <label>assetPath<input id="stgPAsset" type="text" /></label>
              <div class="row">
                <label>X<input id="stgPX" type="number" step="1" /></label>
                <label>Y<input id="stgPY" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label><span id="stgPScaleXLabel">Scale X</span><input id="stgPSX" type="number" step="0.05" /></label>
                <label><span id="stgPScaleYLabel">Scale Y</span><input id="stgPSY" type="number" step="0.05" /></label>
              </div>
              <div class="row"><label><input id="stgPLock" type="checkbox" checked /> 縦横比を固定</label></div>
              <div class="row">
                <label>Alpha<input id="stgPAlpha" type="number" step="0.05" min="0" max="1" /></label>
                <label>Angle<input id="stgPAngle" type="number" step="1" /></label>
                <label>zIndex<input id="stgPZ" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>Scroll X<input id="stgPScrX" type="number" step="0.05" /></label>
                <label>Scroll Y<input id="stgPScrY" type="number" step="0.05" /></label>
              </div>
              <div class="row">
                <label><input id="stgPFlipX" type="checkbox" /> flipX</label>
                <label><input id="stgPFlipY" type="checkbox" /> flipY</label>
                <label><input id="stgPPixel" type="checkbox" /> isPixel</label>
              </div>
              <div class="row">
                <label>Color<span class="stgColor"><input id="stgPColorPick" type="color" value="#ffffff" /><input id="stgPColor" type="text" placeholder="#FFFFFF" /></span></label>
                <label>Blend<select id="stgPBlend">
                  <option value="">（なし）</option>
                  <option>add</option><option>multiply</option><option>screen</option><option>overlay</option>
                  <option>darken</option><option>lighten</option><option>difference</option><option>hardlight</option>
                </select></label>
              </div>
              <div id="stgPAnimRow" class="row" hidden>
                <label>プレビューのアニメ<select id="stgPAnim"></select></label>
                <label><input id="stgPPlay" type="checkbox" /> ▶ 再生</label>
              </div>
              <p id="stgPNote" class="tiny"></p>
            </div>

            <!-- キャラクター -->
            <div id="stgCharFields" hidden>
              <div class="row">
                <label>X（足元）<input id="stgCX" type="number" step="1" /></label>
                <label>Y（足元）<input id="stgCY" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>Scale<input id="stgCScale" type="number" step="0.05" /></label>
                <label>zIndex<input id="stgCZ" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>Camera Offset X<input id="stgCCamX" type="number" step="1" /></label>
                <label>Camera Offset Y<input id="stgCCamY" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>Alpha<input id="stgCAlpha" type="number" step="0.05" min="0" max="1" /></label>
                <label>Angle<input id="stgCAngle" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>Scroll X<input id="stgCScrX" type="number" step="0.05" /></label>
                <label>Scroll Y<input id="stgCScrY" type="number" step="0.05" /></label>
              </div>
              <h3>表示するキャラクター</h3>
              <p class="tiny">読み込み方は2通りです。どちらも、選んだファイルは「ファイルの山」に集まり、あとから探されます。</p>
              <details open>
                <summary>① 一括: character.json とアトラスを一度に</summary>
                <label>まとめて選択<input id="stgCharFiles" type="file" accept=".json,.png,.xml,.txt,image/*" multiple /></label>
                <label class="stgDesktopOnly">フォルダごと選択（PC）<input id="stgCharDir" type="file" webkitdirectory multiple /></label>
              </details>
              <details open>
                <summary>② 分散: json → アトラスを別々に</summary>
                <label>character.json だけ選択<input id="stgCharJson" type="file" accept=".json,application/json" /></label>
                <label>アトラスのファイルを追加（何度でも・別フォルダからでも）<input id="stgCharAssets" type="file" multiple /></label>
                <label class="stgDesktopOnly">フォルダごと追加（PC）<input id="stgCharAssetsDir" type="file" webkitdirectory multiple /></label>
              </details>
              <div id="stgCharNeeds" class="stgAssetList"></div>
              <p class="tiny">対応: sparrow / packer / multisparrow / animateatlas / multianimateatlas。表示に使うのは基準アニメ（danceRight→danceLeft→idle）が使うアトラスだけです。</p>
              <div class="row"><button id="stgCharClear" type="button">キャラを外す</button></div>
              <p id="stgCharInfo" class="tiny"></p>
            </div>
          </aside>

          <aside class="hudPanel" data-hud-panel="stage">
            <h2>ステージ全体</h2>
            <label>name<input id="stgName" type="text" /></label>
            <div class="row">
              <label>cameraZoom<input id="stgCamZoom" type="number" step="0.05" min="0.05" /></label>
              <label>directory<input id="stgDirectory" type="text" /></label>
            </div>
            <h3>プレビュー</h3>
            <label>ゲームカメラの枠（1280×720）
              <select id="stgCamTarget">
                <option value="">表示しない</option>
                <option value="bf">BF を映す</option>
                <option value="dad">DAD を映す</option>
                <option value="gf">GF を映す</option>
              </select>
            </label>
            <div class="row">
              <label>視差プレビュー カメラX<input id="stgViewCamX" type="number" step="10" value="0" /></label>
              <label>カメラY<input id="stgViewCamY" type="number" step="10" value="0" /></label>
              <button id="stgViewCamReset" type="button">0に戻す</button>
            </div>
            <p class="tiny">
              Scroll が1でない物は、カメラが動くと遅れて動きます（視差）。ここでカメラ位置を動かすと見え方を確認できます。保存には影響しません。
            </p>
          </aside>
        </div>

        <div id="stgToast" class="hudToast" hidden></div>
      </div>
    </section>
`;
