/* ============================================================
   note/template.js — Note Editor 画面の HTML
   ------------------------------------------------------------
   Stage / Character Editor と同じ「全画面プレビュー + Hud パネル」方式。ID はすべて "nte" で始まる。
   V-Slice 本体には無いエディタ: noteStyle（data/notestyles/*.json）を編集し、ノーツ・受け皿・ホールド・スプラッシュの
   見た目とオフセットを、プレビューを見ながらドラッグで調整する。
   ============================================================ */
export const template = `
    <section id="noteWorkspace" class="hudWorkspace" hidden>
      <canvas id="nteCanvas"></canvas>
      <div class="hudLayer" data-all-hidden="false">
        <button id="nteHudEye" class="hudEye" type="button" data-hud-all title="Hud の表示 / 非表示 (H)" aria-label="Hud の表示 / 非表示">👁</button>

        <div class="hudBar" data-hud-panel="bar" data-hud-always>
          <button type="button" data-hud-toggle="files" data-ja="📁 ファイル" data-en="📁 Files">📁 ファイル</button>
          <button type="button" data-hud-toggle="group" data-ja="🎯 グループ" data-en="🎯 Group">🎯 グループ</button>
          <button type="button" data-hud-toggle="entry" data-ja="🎞 アニメ" data-en="🎞 Anim">🎞 アニメ</button>
          <button type="button" data-hud-toggle="scroll" data-ja="🎯 判定・スクロール" data-en="🎯 Hit / Scroll">🎯 判定・スクロール</button>
          <span class="hudSep"></span>
          <button id="nteZoomOut" type="button" title="ズームアウト">−</button>
          <input id="nteZoom" type="number" min=".05" max="16" step=".05" value="1" title="ズーム（ホイールでも可）" />
          <button id="nteZoomIn" type="button" title="ズームイン">＋</button>
          <button id="nteFit" type="button" title="全体を画面に収める (F)">⊡ 全体</button>
          <button id="nteResetView" type="button" title="ズーム100%">⌖ 原点</button>
          <button id="ntePanTool" type="button" title="左ドラッグでビューを動かす（Space長押し / 中・右ドラッグでも可）">✋ 移動</button>
          <label class="hudCheck" title="アニメーションを再生する"><input id="ntePlay" type="checkbox" checked /><span>▶ 再生</span></label>
          <label class="hudCheck" title="ノーツの大きさの目安（レーンの枠）"><input id="nteGuide" type="checkbox" checked /><span>枠</span></label>
          <span class="hudSep"></span>
          <span id="nteReadout" class="hudReadout"></span>
        </div>

        <div class="hudDock hudDockLeft">
          <aside class="hudPanel" data-hud-panel="files">
            <h2>Note Editor</h2>
            <p class="tiny">noteStyle（data/notestyles/*.json）の見た目とオフセットを編集します。V-Slice 本体には無い、Funkin' Studio のエディタです。</p>
            <div class="row">
              <button id="nteNew" type="button">新規</button>
              <button id="nteSave" class="primary" type="button">mod zip に書き出す</button>
            </div>
            <label>noteStyle の JSON を開く<input id="nteFile" type="file" accept=".json,application/json" /></label>
            <label>画像・XML・JSON を追加（複数可。fallback 先の noteStyle もここへ）<input id="nteAssets" type="file" multiple accept="image/*,.xml,.json,text/xml,application/json" /></label>
            <div class="row"><label class="hudCheck"><input id="nteCompact" type="checkbox" /> 整形して保存（オフ=1行の軽量JSON）</label></div>
            <h3>スタイル情報</h3>
            <label>name<input id="nteName" type="text" /></label>
            <div class="row">
              <label>author<input id="nteAuthor" type="text" /></label>
              <label>fallback（無い項目の代わりに使う noteStyle）<input id="nteFallback" type="text" list="nteIds" placeholder="funkin" /></label>
            </div>
            <datalist id="nteIds"></datalist>
            <div id="nteMissing" class="tiny"></div>
          </aside>
        </div>

        <div class="hudDock hudDockRight">
          <aside class="hudPanel" data-hud-panel="group">
            <h2>グループ</h2>
            <p class="tiny">プレビューの絵をクリックすると、そのグループが選ばれます。ドラッグで offsets が動きます（Shift: 縦横どちらかに固定 / Alt: 小数のまま）。</p>
            <label>編集するグループ
              <select id="nteGroup">
                <option value="noteStrumline">noteStrumline（受け皿）</option>
                <option value="note">note（ノーツの頭）</option>
                <option value="holdNote">holdNote（ホールドの胴体・終端）</option>
                <option value="noteSplash">noteSplash（ヒット時のスプラッシュ）</option>
                <option value="holdNoteCover">holdNoteCover（ホールド中のカバー）</option>
              </select>
            </label>
            <label>assetPath<input id="nteAssetPath" type="text" placeholder="notes/corrupt/corrupt_note" /></label>
            <div class="row">
              <label>scale<input id="nteScale" type="number" step="0.01" min="0.01" /></label>
              <label>alpha<input id="nteAlpha" type="number" step="0.05" min="0" max="1" /></label>
            </div>
            <div class="row">
              <label>offsets X<input id="nteOffX" type="number" step="1" /></label>
              <label>offsets Y<input id="nteOffY" type="number" step="1" /></label>
              <button id="nteOffZero" type="button">0,0</button>
            </div>
            <div class="row"><label class="hudCheck"><input id="nteIsPixel" type="checkbox" /> isPixel（ドット絵・補間なし）</label></div>
            <div class="row"><label class="hudCheck" title="オフにすると、グループ全体の offsets を動かします"><input id="nteDragEntry" type="checkbox" /> ドラッグで「選択中のアニメ個別」の offsets を動かす</label></div>
            <div id="nteGroupInfo" class="tiny"></div>
          </aside>
          <aside class="hudPanel" data-hud-panel="scroll">
            <h2>判定・スクロール</h2>
            <label>表示
              <select id="nteView">
                <option value="board">ボード（絵とオフセットを並べて見る）</option>
                <option value="scroll">スクロールテスト（ノーツが流れて、判定位置で消える）</option>
              </select>
            </label>
            <div class="row">
              <label>スクロール速度（chart の scrollSpeed）<input id="nteSpeed" type="number" step="0.1" min="0.1" max="12" value="2" /></label>
              <label>BPM<input id="nteBpm" type="number" step="1" min="30" max="300" value="120" /></label>
            </div>
            <input id="nteSpeedRange" type="range" min="0.5" max="8" step="0.1" value="2" />
            <div class="row"><label class="hudCheck"><input id="nteDown" type="checkbox" /> ダウンスクロール（上から下へ流れる）</label></div>
            <div class="row"><label class="hudCheck"><input id="nteWindows" type="checkbox" checked /> 判定の幅を表示</label></div>
            <div class="row">
              <label>Sick ±ms<input id="nteWSick" type="number" step="1" min="1" value="45" /></label>
              <label>Good ±ms<input id="nteWGood" type="number" step="1" min="1" value="90" /></label>
            </div>
            <div class="row">
              <label>Bad ±ms<input id="nteWBad" type="number" step="1" min="1" value="135" /></label>
              <label>Shit ±ms<input id="nteWShit" type="number" step="1" min="1" value="160" /></label>
            </div>
            <p class="tiny">ノーツは「受け皿の中心」に重なった瞬間（= 判定の時刻）に消え、受け皿が Confirm になります。ノーツの絵と受け皿の絵が、その瞬間にぴったり重なるように、offsets を合わせてください（スクロールテストの表示でも、絵をドラッグして動かせます）。1ms あたり 0.45px × 速度で流れます（V-Slice の PIXELS_PER_MS）。判定の幅の初期値は V-Slice 0.8 の目安です。</p>
            <div id="nteAlign" class="tiny"></div>
          </aside>
          <aside class="hudPanel" data-hud-panel="entry">
            <h2>アニメ</h2>
            <label>対象<select id="nteEntry"></select></label>
            <label>prefix（XML のフレーム名の頭）<input id="nteEntryPrefix" type="text" /></label>
            <div class="row">
              <label>offsets X<input id="nteEntryOffX" type="number" step="1" /></label>
              <label>offsets Y<input id="nteEntryOffY" type="number" step="1" /></label>
            </div>
            <div id="nteFrameInfo" class="tiny"></div>
            <div id="nteSpecial"></div>
          </aside>
        </div>

        <div class="hudTransport" data-hud-panel="transport"><div id="nteStatus" class="tiny">noteStyle を開くか、「新規」で作り始めてください。</div></div>
        <div id="nteToast" class="hudToast" hidden></div>
      </div>
    </section>
`;
