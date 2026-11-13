/* ============================================================
   character/template.js — character 画面の HTML
   ------------------------------------------------------------
   v3.1 で「全画面プレビュー + Hud パネル」構成に変更。
     ・#offCanvas が画面いっぱい（パン / ズーム可能。ui/Viewport.js）
     ・操作パネルはすべて .hudLayer の中の Hud。ボタンで個別に、👁 で一括して表示/非表示（ui/HudPanels.js）
   ID はすべて従来どおり（editor.js のロジックはそのまま使う）。
   新しく増えた ID: offHudBar / offReadout / offShowBox / offFit / offResetView / offPanTool / offZoomIn / offZoomOut
   JS メモ: バッククォートのテンプレートリテラルなので複数行OK。data-ja / data-en は i18n の指定（英語表示用）。
   ============================================================ */
export const template = `
    <section id="offsetWorkspace" class="hudWorkspace" hidden>
      <canvas id="offCanvas"></canvas>

      <div class="hudLayer" data-all-hidden="false">
        <!-- すべての Hud を隠す/戻す（Hud を全部隠しても、このボタンだけは残る。キーボードは H） -->
        <button
          id="offHudEye"
          class="hudEye"
          type="button"
          data-hud-all
          title="Hud の表示 / 非表示 (H)"
          aria-label="Hud の表示 / 非表示"
        >👁</button>

        <!-- 上のバー: パネルの切り替え・Undo/Redo・ビュー操作 -->
        <div id="offHudBar" class="hudBar" data-hud-panel="bar" data-hud-always>
          <button type="button" data-hud-toggle="files" data-ja="📁 ファイル" data-en="📁 Files">📁 ファイル</button>
          <button type="button" data-hud-toggle="anim" data-ja="🎞 アニメ" data-en="🎞 Anim">🎞 アニメ</button>
          <button type="button" data-hud-toggle="char" data-ja="🧍 キャラ" data-en="🧍 Character">🧍 キャラ</button>
          <button type="button" data-hud-toggle="transport" data-ja="▶ 再生バー" data-en="▶ Playback">▶ 再生バー</button>
          <span class="hudSep"></span>
          <button id="offUndo" type="button" title="元に戻す (Ctrl+Z)">↶ 戻す</button>
          <button id="offRedo" type="button" title="やり直す (Ctrl+Y)">↷ やり直す</button>
          <span class="hudSep"></span>
          <button id="offZoomOut" type="button" title="ズームアウト">−</button>
          <input id="offZoom" type="number" min=".05" max="16" step=".1" value="1" title="ズーム（ホイールでも可）" />
          <button id="offZoomIn" type="button" title="ズームイン">＋</button>
          <button id="offFit" type="button" title="キャラ全体を画面に収める (F)" data-ja="⊡ 全体" data-en="⊡ Fit">⊡ 全体</button>
          <button id="offResetView" type="button" title="ズーム100%・原点を中央へ" data-ja="⌖ 原点" data-en="⌖ Origin">⌖ 原点</button>
          <button id="offPanTool" type="button" title="左ドラッグでビューを動かす（Space長押し / 中・右ドラッグでも可）" data-ja="✋ 移動" data-en="✋ Pan">✋ 移動</button>
          <label class="hudCheck" title="フレームの枠を表示"><input id="offShowBox" type="checkbox" checked /><span data-ja="枠" data-en="Box">枠</span></label>
          <span id="offReadout" class="hudReadout"></span>
        </div>

        <!-- 左: ファイル -->
        <div class="hudDock hudDockLeft">
          <aside class="hudPanel" data-hud-panel="files">
            <h2>V-Slice Character Editor 3.0</h2>
            <p class="tiny">
              アニメーションoffsetの＋は左・上。全体offsetの＋は右・下。scaleもOffsetに適用し、フレーム切替時に原点を再計算しません。
            </p>
            <label
              >① character.json（最初に読み込む）<input
                id="offCharacter"
                type="file"
                accept=".json"
            /></label>
            <div class="row">
              <button id="offDetect" class="primary" type="button">
                JSONを解析して必要なアトラスを検出
              </button>
            </div>
            <div id="offRequiredAssets" style="margin: 12px 0">
              <p class="tiny">
                Character
                JSONを解析すると、assetPathごとにアップロード欄が表示されます。
              </p>
            </div>
            <p class="tiny">
              各assetPathにPNGとXML（Packer は TXT）、またはPNG・spritemap
              JSON・Animation.jsonを登録します。登録したファイルは端末内でのみ処理されます。
            </p>
            <div class="row">
              <button id="offLoad" class="primary">JSONを解析 / 再読み込み</button
              ><button id="offExport" class="primary">character.json 保存</button>
            </div>
            <div class="row">
              <label
                ><input id="offCompactExport" type="checkbox" checked />
                JSON最適化（空白・改行を削除）</label
              >
            </div>
            <p class="tiny">
              標準では軽量な1行JSONで保存します。チェックを外すと読みやすい整形JSONになります。データの値や未編集項目は削除しません。
            </p>
          </aside>
        </div>

        <!-- 右: アニメーション（オフセット調整の中心）とキャラクター全体 -->
        <div class="hudDock hudDockRight">
          <aside class="hudPanel" data-hud-panel="anim">
            <h2>アニメーション設定</h2>
            <div id="offAssetInfo" class="tiny"></div>
            <label
              >アニメーション<select id="offSelect" style="width: 100%"></select
            ></label>
            <div class="row">
              <button id="offAddAnim" class="primary">＋ アニメーション追加</button
              ><button id="offRenameAnim">名前変更</button
              ><button id="offDeleteAnim">削除</button>
            </div>
            <div class="row">
              <label>Offset X<input id="offX" type="number" step="0.01" /></label
              ><label>Offset Y<input id="offY" type="number" step="0.01" /></label>
            </div>
            <div class="row">
              <button id="offZero">オフセットを 0, 0 に</button>
            </div>
            <p class="tiny">
              プレビューをドラッグ、または矢印キーで動かせます（Shiftで10、Altで0.1刻み）。ドラッグ右→Offset
              X減少、ドラッグ下→Offset Y減少。正のオフセットは左・上へ動きます。
            </p>
            <div class="row">
              <label>FPS<input id="offFps" type="number" min="1" max="120" /></label
              ><label
                >Loop<select id="offLoop">
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select></label
              >
            </div>
            <details>
              <summary data-ja="詳細（Prefix / animType / frameIndices）" data-en="Advanced (Prefix / animType / frameIndices)">詳細（Prefix / animType / frameIndices）</summary>
              <label
                >アニメーション名 / Prefix<input id="offPrefix" type="text"
              /></label>
              <label
                >animType<select id="offAnimType">
                  <option value="">未指定（既存値を維持）</option>
                  <option value="prefix">prefix</option>
                  <option value="indices">indices</option>
                  <option value="symbol">symbol</option>
                  <option value="frameLabel">frameLabel</option>
                </select></label
              >
              <label
                >frameIndices（カンマ区切り、空欄は未指定）<textarea
                  id="offIndices"
                  placeholder="0, 1, 2, 3"
                ></textarea>
              </label>
            </details>
            <button id="offApply" class="primary" style="width: 100%; margin-top: 8px">
              アニメーション設定を適用
            </button>
          </aside>

          <aside class="hudPanel" data-hud-panel="char">
            <h2>キャラクター全体</h2>
            <div class="row">
              <label
                >プレビュー方式<select id="offFormat">
                  <option value="auto">自動判別</option>
                  <option value="sparrow">Sparrow</option>
                  <option value="animate">AnimateAtlas</option>
                  <option value="frameLabel">FrameLabel</option>
                </select></label
              >
            </div>
            <div class="row">
              <label
                ><input id="offFlipX" type="checkbox" /> flipX（Character
                JSONに保存）</label
              >
            </div>
            <div class="row">
              <label
                >プレビューの向き<select id="offPreviewFacing">
                  <option value="raw">編集用：元画像の向き（反転なし）</option>
                  <option value="json">JSONのflipXを適用</option>
                </select></label
              >
            </div>
            <p class="tiny">
              プレイヤーキャラも「元画像の向き」で編集できます。プレビューの切り替えはJSONに保存されません。flipXは「基本情報を適用」で保存対象になります。
            </p>
            <div class="row">
              <label
                >キャラクター名 (name)<input
                  id="offCharName"
                  type="text"
                  placeholder="Boyfriend" /></label
              ><label
                >Generated By (generatedBy)<input
                  id="offGeneratedBy"
                  type="text"
                  readonly
              /></label>
            </div>
            <div class="row">
              <button id="offMetaApply" class="primary">基本情報を適用</button
              ><span class="tiny">generatedBy は自動で設定され、変更できません</span>
            </div>
            <div class="row">
              <label
                >Global Offset X<input
                  id="offGlobalX"
                  type="number"
                  step="0.01" /></label
              ><label
                >Global Offset Y<input id="offGlobalY" type="number" step="0.01"
              /></label>
            </div>
            <div class="row">
              <label
                >renderType<input id="offRenderType" type="text" readonly /></label
              ><button id="offGlobalApply">全体オフセットを適用</button>
            </div>
            <h3>キャラクター設定（V-Slice）</h3>
            <p class="tiny">scale を変えるとプレビューもすぐ変わります。既定値のままの項目は、JSON に書き出しません（元から書かれていた項目は残します）。</p>
            <div class="row">
              <label>scale<input id="offScale" type="number" step="0.01" min="0.01" /></label
              ><label title="歌ってから idle に戻るまでの長さ（ステップ数。既定 8）">singTime<input id="offSingTime" type="number" step="0.1" min="0" /></label
              ><label title="何拍ごとに idle を再生するか（既定 1）">danceEvery<input id="offDanceEvery" type="number" step="0.5" min="0" /></label>
            </div>
            <div class="row">
              <label>startingAnimation<select id="offStartAnim"></select></label
              ><label class="hudCheck"><input id="offIsPixel" type="checkbox" /> isPixel（ドット絵・補間なし）</label>
            </div>
            <div class="row">
              <label>cameraOffsets X<input id="offCamX" type="number" step="1" /></label
              ><label>cameraOffsets Y<input id="offCamY" type="number" step="1" /></label>
            </div>
            <details>
              <summary>healthIcon（ヘルスアイコン）</summary>
              <div class="row">
                <label>id<input id="offHIId" type="text" placeholder="bf" /></label
                ><label>scale<input id="offHIScale" type="number" step="0.01" min="0.01" /></label>
              </div>
              <div class="row">
                <label class="hudCheck"><input id="offHIPixel" type="checkbox" /> isPixel</label
                ><label class="hudCheck"><input id="offHIFlip" type="checkbox" /> flipX</label>
              </div>
              <div class="row">
                <label>offsets X<input id="offHIOffX" type="number" step="1" /></label
                ><label>offsets Y<input id="offHIOffY" type="number" step="1" /></label>
              </div>
            </details>
            <details>
              <summary>death（ゲームオーバー演出）</summary>
              <div class="row">
                <label>cameraOffsets X<input id="offDeathCamX" type="number" step="1" /></label
                ><label>cameraOffsets Y<input id="offDeathCamY" type="number" step="1" /></label>
              </div>
              <div class="row">
                <label>cameraZoom<input id="offDeathZoom" type="number" step="0.01" min="0.01" /></label
                ><label>preTransitionDelay<input id="offDeathDelay" type="number" step="0.1" min="0" /></label>
              </div>
            </details>
            <div class="row"><button id="offPropsApply" class="primary">キャラクター設定を適用</button></div>
          </aside>
        </div>

        <!-- 下: 再生バー + ステータス -->
        <div class="hudTransport" data-hud-panel="transport">
          <div class="row">
            <button id="offPrev">◀ 1F</button><button id="offPlay">▶ 再生</button
            ><button id="offNext">1F ▶</button
            ><span id="offCounter" class="tiny">0 / 0</span>
            <input
              id="offTimeline"
              type="range"
              min="0"
              max="0"
              value="0"
              style="flex: 1 1 140px; min-width: 100px"
            />
          </div>
          <div id="offStatus" class="tiny">
            character.json と画像・アトラス定義を選択してください。
          </div>
        </div>

        <!-- 再生バーを隠しているとき、ステータスメッセージを数秒だけここに出す -->
        <div id="offToast" class="hudToast" hidden></div>
      </div>
    </section>
`;
