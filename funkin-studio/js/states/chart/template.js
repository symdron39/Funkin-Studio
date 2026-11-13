/* ============================================================
   chart/template.js — Chart Editor 画面の HTML
   ------------------------------------------------------------
   Character / Stage Editor と同じ「全画面キャンバス + Hud パネル」方式。ID はすべて "cht" で始まる。
   ・キャンバス: 縦スクロールのグリッド（ホイール=時間送り / Ctrl+ホイール=拡大縮小）
   ・左: ファイル / 曲情報 / 難易度 / BPM　・右: 編集（選択中の中身・イベント）/ 音声
   ・下: 再生バー
   ============================================================ */
export const template = `
    <section id="chartWorkspace" class="hudWorkspace" hidden>
      <canvas id="chtCanvas"></canvas>

      <div class="hudLayer" data-all-hidden="false">
        <button id="chtHudEye" class="hudEye" type="button" data-hud-all title="Hud の表示 / 非表示 (H)" aria-label="Hud の表示 / 非表示">👁</button>

        <div class="hudBar" data-hud-panel="bar" data-hud-always>
          <button type="button" data-hud-toggle="files" data-ja="📁 ファイル" data-en="📁 Files">📁 ファイル</button>
          <button type="button" data-hud-toggle="song" data-ja="🎵 曲情報" data-en="🎵 Song">🎵 曲情報</button>
          <button type="button" data-hud-toggle="diff" data-ja="🎚 難易度" data-en="🎚 Difficulty">🎚 難易度</button>
          <button type="button" data-hud-toggle="timing" data-ja="⏱ BPM" data-en="⏱ BPM">⏱ BPM</button>
          <button type="button" data-hud-toggle="edit" data-ja="✏ 編集" data-en="✏ Edit">✏ 編集</button>
          <button type="button" data-hud-toggle="audio" data-ja="🔊 音声" data-en="🔊 Audio">🔊 音声</button>
          <span class="hudSep"></span>
          <button id="chtPlayBtn" type="button" title="この難易度をプレイテスト (P)">🎮 プレイテスト</button>
          <span class="hudSep"></span>
          <button id="chtToolPlace" type="button" aria-pressed="true" title="配置: クリックでノーツ/イベントを置く・ドラッグで長さ・選択物をドラッグで移動 (1)">✏ 配置</button>
          <button id="chtToolSelect" type="button" aria-pressed="false" title="選択: ドラッグで範囲選択 (2)">▭ 選択</button>
          <button id="chtToolPan" type="button" aria-pressed="false" title="スクロール: ドラッグで時間送り（スマホ向け） (3)">✋ 移動</button>
          <span class="hudSep"></span>
          <button id="chtZoomOut" type="button" title="縮小">−</button>
          <button id="chtZoomIn" type="button" title="拡大">＋</button>
          <label class="chtInline" title="スナップ（←/→ キーでも変更）">スナップ
            <select id="chtSnap"></select>
          </label>
          <span class="hudSep"></span>
          <span id="chtReadout" class="hudReadout"></span>
        </div>

        <div class="hudDock hudDockLeft">
          <aside class="hudPanel" data-hud-panel="files">
            <h2>Chart Editor</h2>
            <div class="row">
              <button id="chtNew" type="button">新規</button>
              <button id="chtSaveFnfc" class="primary" type="button" title="chart + metadata + 音声をまとめた .fnfc（公式の Chart Editor で開けます）">.fnfc 保存</button>
            </div>
            <label>開く（.fnfc / chart.json / metadata.json / 音声。複数可）
              <input id="chtOpen" type="file" multiple />
            </label>
            <label>ファイルを追加（別フォルダのものを足す）
              <input id="chtAdd" type="file" multiple />
            </label>
            <div class="row">
              <label class="chtFileBtn">Inst を選ぶ<input id="chtInst" type="file" hidden /></label>
              <label class="chtFileBtn">Voices を追加<input id="chtVoices" type="file" multiple hidden /></label>
            </div>
            <h3>イベントのスクリプト（HScript）</h3>
            <label>.hxc / .hx を読み込む（複数可・modの zip も可）
              <input id="chtScripts" type="file" multiple />
            </label>
            <div id="chtScriptList" class="chtTable"></div>
            <p class="tiny">SongEvent を継承したクラスから、イベントの ID・名前・項目を読み取って、イベントの種類に追加します（スクリプトは実行しません）。読み込んだものはこのブラウザに記憶されます。</p>
            <h3>個別に保存（いまのバリエーション）</h3>
            <div class="row">
              <button id="chtSaveChart" type="button">chart → mod zip</button>
              <button id="chtSaveMeta" type="button">metadata.json</button>
              <button id="chtSaveAllJson" type="button" title="全バリエーションの JSON と音声を、mod の zip にまとめて書き出す">mod zip（全部）</button>
            </div>
            <div class="row"><label><input id="chtCompact" type="checkbox" /> 1行の軽量JSONで保存</label></div>
            <label>songId（ファイル名に使う）<input id="chtSongId" type="text" placeholder="例: bopeebo" /></label>
            <div id="chtStatus" class="tiny"></div>
          </aside>

          <aside class="hudPanel" data-hud-panel="song">
            <h2>曲情報（metadata）</h2>
            <p class="tiny">編集中のバリエーションの metadata です。</p>
            <label>songName<input id="chtSongName" type="text" /></label>
            <div class="row">
              <label>artist<input id="chtArtist" type="text" /></label>
              <label>charter<input id="chtCharter" type="text" /></label>
            </div>
            <div class="row">
              <label>stage<input id="chtStage" type="text" /></label>
              <label>noteStyle<input id="chtNoteStyle" type="text" /></label>
            </div>
            <h3>キャラクター</h3>
            <div class="row">
              <label>player<input id="chtCharPlayer" type="text" /></label>
              <label>girlfriend<input id="chtCharGf" type="text" /></label>
              <label>opponent<input id="chtCharOpp" type="text" /></label>
            </div>
            <label>instrumental（空=既定の Inst）<input id="chtCharInst" type="text" /></label>
            <label>altInstrumentals（カンマ区切り）<input id="chtCharAltInst" type="text" /></label>
            <label>playerVocals（カンマ区切り・空=player）<input id="chtCharPVoc" type="text" /></label>
            <label>opponentVocals（カンマ区切り・空=opponent）<input id="chtCharOVoc" type="text" /></label>
            <h3>その他</h3>
            <div class="row">
              <label>album<input id="chtAlbum" type="text" /></label>
              <label>stickerPack<input id="chtSticker" type="text" /></label>
            </div>
            <div class="row">
              <label>previewStart (ms)<input id="chtPrevStart" type="number" step="100" /></label>
              <label>previewEnd (ms)<input id="chtPrevEnd" type="number" step="100" /></label>
            </div>
            <div class="row">
              <button id="chtPrevFromHead" type="button" title="再生位置をプレビュー開始にする">▶ここを開始</button>
              <button id="chtPrevToHead" type="button">■ここを終了</button>
            </div>
            <label>discordRPCImage<input id="chtDiscord" type="text" /></label>
            <div class="row">
              <label><input id="chtLooped" type="checkbox" /> looped</label>
              <label>divisions<input id="chtDivisions" type="number" step="1" /></label>
            </div>
            <h3>音声オフセット (ms)</h3>
            <div class="row">
              <label>instrumental<input id="chtOffInst" type="number" step="1" /></label>
              <label>vocals（全体）<input id="chtOffVoc" type="number" step="1" /></label>
            </div>
            <p class="tiny">vocals のキャラ別のオフセットは、保存時にそのまま残ります。ここでは全キャラ共通の値を一括で設定します。</p>
          </aside>

          <aside class="hudPanel" data-hud-panel="diff">
            <h2>バリエーション・難易度</h2>
            <p class="tiny">切り替えは下の再生バーのメニューから。</p>
            <div class="row">
              <button id="chtAddVar" type="button" title="新しいバリエーションを追加">＋</button>
              <button id="chtDelVar" type="button" title="このバリエーションを削除">🗑</button>
            </div>
            <div class="row">
              <button id="chtAddDiff" type="button">＋ 空の難易度</button>
              <button id="chtDupDiff" type="button" title="いまの難易度のノーツをコピーして追加">⧉ 複製して追加</button>
              <button id="chtDelDiff" type="button">🗑 削除</button>
            </div>
            <div id="chtDiffTable" class="chtTable"></div>
            <p class="tiny">scrollSpeed と ratings は難易度ごとです。events（カメラなど）は同じバリエーションの全難易度で共通です。</p>
          </aside>

          <aside class="hudPanel" data-hud-panel="timing">
            <h2>BPM・拍子（timeChanges）</h2>
            <div id="chtTimeList" class="chtTable"></div>
            <div class="row">
              <button id="chtAddTime" type="button" title="再生位置の小節の頭に変更点を追加">＋ ここに追加</button>
            </div>
            <div class="row"><label><input id="chtKeepSteps" type="checkbox" /> BPM を変えたら、ノーツ・イベントの時間を再計算（step 位置を保つ）</label></div>
            <p class="tiny">オフのときは公式と同じで、ノーツの時間(ms)はそのまま、グリッド上の位置だけが変わります。</p>
          </aside>
        </div>

        <div class="hudDock hudDockRight">
          <aside class="hudPanel" data-hud-panel="edit">
            <h2>編集</h2>
            <div class="row">
              <button id="chtDel" type="button" title="削除 (Delete)">削除</button>
              <button id="chtCopy" type="button" title="Ctrl+C">コピー</button>
              <button id="chtCut" type="button" title="Ctrl+X">切り取り</button>
              <button id="chtPaste" type="button" title="再生位置に貼り付け (Ctrl+V)">貼り付け</button>
            </div>
            <div class="row">
              <button id="chtSelAll" type="button" title="Ctrl+A">全選択</button>
              <button id="chtMirror" type="button" title="左右を入れ替える (M)">↔ ミラー</button>
              <button id="chtFlip" type="button" title="プレイヤー↔相手 (Shift+M)">⇄ 反転</button>
              <button id="chtUnstack" type="button" title="同じ位置に重なったノーツを1つにする">重なり除去</button>
            </div>
            <h3>新しく置くノーツ</h3>
            <div class="row">
              <label>kind（空=通常）<input id="chtPlaceKind" type="text" list="chtKinds" /></label>
            </div>
            <datalist id="chtKinds"></datalist>
            <h3 id="chtSelTitle">選択中</h3>
            <p id="chtNoSel" class="tiny">グリッドでノーツ・イベントをクリックして選んでください。</p>
            <div id="chtNoteFields" hidden>
              <div class="row">
                <label>長さ (ms)<input id="chtNLen" type="number" step="10" min="0" /></label>
                <label>kind<input id="chtNKind" type="text" list="chtKinds" /></label>
              </div>
              <div class="row">
                <label>時間 (ms)<input id="chtNTime" type="number" step="1" /></label>
                <label>方向<select id="chtNDir"></select></label>
              </div>
              <div id="chtNParams"></div>
              <button id="chtNAddParam" type="button">＋ param</button>
            </div>
            <div id="chtEventFields" hidden>
              <div class="row">
                <label>種類<select id="chtEKind"></select></label>
                <label>時間 (ms)<input id="chtETime" type="number" step="1" /></label>
              </div>
              <div id="chtEForm"></div>
            </div>
            <h3>イベント（右端の列に置く）</h3>
            <div class="row">
              <label>置くイベント<select id="chtPalette"></select></label>
            </div>
            <div class="row" id="chtCustomRow" hidden>
              <label>カスタム名（スクリプトのイベント）<input id="chtCustomKind" type="text" placeholder="MyEvent" /></label>
            </div>
            <div class="row"><button id="chtAddEventHead" type="button">＋ 再生位置にイベントを追加</button></div>
          </aside>

          <aside class="hudPanel" data-hud-panel="audio">
            <h2>音声トラック</h2>
            <p class="tiny">いまのバリエーションで使うトラックだけが鳴ります。波形はチェックしたトラックを重ねて表示します。</p>
            <div id="chtTracks" class="chtTable"></div>
            <div class="row">
              <label>再生速度
                <select id="chtRate"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select>
              </label>
              <label><input id="chtHitSound" type="checkbox" /> ヒット音</label>
            </div>
          </aside>
        </div>

        <div class="hudTransport" data-hud-panel="transport">
          <div class="row">
            <button id="chtPlay" class="primary" type="button" title="再生 / 一時停止 (Space)">▶</button>
            <button id="chtStop" type="button" title="先頭へ (Home)">⏮</button>
            <input id="chtSeek" type="range" min="0" max="1000" step="1" value="0" style="flex:1" title="位置" />
            <span id="chtTime" class="hudReadout"></span>
          </div>
          <div class="row">
            <label class="chtInline">バリエーション <select id="chtVariation"></select></label>
            <label class="chtInline">難易度 <select id="chtDifficulty"></select></label>
          </div>
          <div id="chtHint" class="hudStatus tiny"></div>
        </div>

        <div id="chtToast" class="hudToast" hidden></div>
      </div>

      <div id="chtPlayRoot" class="chtPlay" hidden>
        <canvas id="chtPlayCanvas"></canvas>
        <button id="chtPlayPause" class="chtPlayPauseBtn" type="button" title="一時停止 (Esc)">⏸</button>
        <div id="chtPlayCard" class="chtPlayCard">
          <h2 id="chtPlayTitle">プレイテスト</h2>
          <div id="chtPlayInfo" class="tiny"></div>
          <div id="chtPlayOpts">
            <div class="row">
              <label>開始位置
                <select id="chtPlayStartFrom"><option value="playhead">再生位置から</option><option value="head">先頭から</option></select>
              </label>
              <label>速度倍率<input id="chtPlaySpeed" type="number" step="0.1" min="0.1" /></label>
            </div>
            <div class="row">
              <label>入力オフセット (ms)<input id="chtPlayOffset" type="number" step="1" /></label>
              <label>再生速度
                <select id="chtPlayRate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select>
              </label>
            </div>
            <div class="row">
              <label><input id="chtPlayDown" type="checkbox" /> ダウンスクロール</label>
              <label><input id="chtPlayOpp" type="checkbox" /> 相手ノーツを表示</label>
              <label><input id="chtPlayBot" type="checkbox" /> ボット</label>
              <label><input id="chtPlayHit" type="checkbox" /> ヒット音</label>
            </div>
            <div class="row">
              <label>ノートスキン <select id="chtPlaySkin"></select></label>
              <button id="chtPlaySkinLoad" type="button">スキンを読み込む…</button>
              <input id="chtPlaySkinFiles" type="file" multiple accept=".json,.png,.xml,.zip" hidden />
            </div>
            <div id="chtPlaySkinInfo" class="tiny"></div>
            <div class="row">
              <label><input id="chtPlayScene" type="checkbox" /> ステージとキャラクターを表示（読み込んだ mod から）</label>
            </div>
            <div class="row">
              <label><input id="chtPlayScripts" type="checkbox" /> イベントスクリプトを実行（読み込み済みの .hxc）</label>
            </div>
            <div class="row">
              <label>キー 左<input id="chtPlayKey0" type="text" maxlength="2" /></label>
              <label>下<input id="chtPlayKey1" type="text" maxlength="2" /></label>
              <label>上<input id="chtPlayKey2" type="text" maxlength="2" /></label>
              <label>右<input id="chtPlayKey3" type="text" maxlength="2" /></label>
            </div>
          </div>
          <canvas id="chtPlayHist" width="360" height="90" hidden></canvas>
          <div class="row">
            <button id="chtPlayGo" class="primary" type="button">開始</button>
            <button id="chtPlayRestart" type="button" hidden>最初から</button>
            <button id="chtPlayApply" type="button" hidden>ズレを補正</button>
            <button id="chtPlayExit" type="button">エディタへ戻る</button>
          </div>
          <p class="tiny">Esc: 一時停止 / 再開。スマホは画面をタップ（右側のレーンが自分）。ズレの + は「遅い」です。</p>
        </div>
      </div>
    </section>
`;
