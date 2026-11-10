/* ============================================================
   services/Autosave.js — ローカル自動保存と復元（v2.7.9）
   ------------------------------------------------------------
   Animate Editor で開いている作業（Animation.json・spritemap・アトラスPNG）を、ブラウザ内の IndexedDB に自動で保存し、
   ブラウザを閉じたり再読み込みしたあとでも「前回の作業を復元」で戻せるようにする。
   Cookie ではなく IndexedDB を使う理由: アトラスPNGや Animation.json は Cookie の容量(1つ数KB)に収まらないため。
   エディタの状態は AnimateEditorState.api（下の A）経由で読み書きする。
   保存するのは常に1件だけ（上書き）。

   目次: 1.保存先(IndexedDB) 2.右下の復元パネル 3.自動保存 4.復元 5.自動保存のきっかけ
   ============================================================ */
// 起動時に main.js から1回だけ呼ぶ。app は復元時に Animate 画面を開く（app.switchTo）ために使う
export function startAutosave(app) {
  // ============================================================
  // 1. 保存先（IndexedDB）
  // ============================================================
  // DB = データベース名 / STORE = その中の保存場所 / KEY = 保存データの名前
  const DB = "FunkinStudioLocalRecovery",
    STORE = "sessions",
    KEY = "animate-current";
  // dbPromise     : DB 接続の使い回し用
  // lastSignature : 最後に保存した内容の「指紋」（変化したかの判定用）
  // writing       : 保存中か / pending : 保存中に次の保存要求が来た印
  // lastSaved     : 最後に保存した時刻
  let dbPromise = null,
    lastSignature = "",
    writing = false,
    pending = false,
    lastSaved = 0;
  // DB を開く（初回だけ接続し、以降は同じ接続を返す。保存場所が無ければ作る）
  const openDB = () =>
    dbPromise ||
    (dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  // get(): 保存データを読む / put(v): 上書き保存 / drop(): 削除
  const get = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const r = t.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  const put = async (v) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(v, KEY);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  };
  const drop = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).delete(KEY);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  };

  // ============================================================
  // 2. 右下の復元パネル
  // ============================================================
  // 画面の右下に固定表示するパネルを JS で作る（保存状況の表示と、復元・今すぐ保存・削除・閉じるボタン）。
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:9999;background:#242635;color:#fff;border:1px solid #777;border-radius:12px;padding:10px;max-width:min(340px,85vw);font:12px sans-serif;box-shadow:0 3px 16px #0009";
  panel.innerHTML =
    '<div style="font-weight:bold;margin-bottom:6px">💾 ローカル復元 / Local recovery</div><div id="fsRecoveryStatus" style="margin-bottom:8px">準備中...</div><div style="display:flex;gap:5px;flex-wrap:wrap"><button type="button" id="fsRecover">前回の作業を復元</button><button type="button" id="fsSaveNow">今すぐ保存</button><button type="button" id="fsForget">復元データを削除</button><button type="button" id="fsHideRecovery">閉じる</button></div>';
  document.body.append(panel);
  const stat = panel.querySelector("#fsRecoveryStatus");
  // update(txt): パネルの状況表示を書き換える
  const update = (txt) => {
    stat.textContent = txt;
  };
  // Animate エディタの api（states/animate/editor.js の return した api）。
  // エディタ画面は「最初に開かれたとき」に初めて作られるので、使うたびに refreshA() で取り直す。
  // まだ開かれていなければ null（= 保存するものが無い）
  let A = null;
  const refreshA = () => (A = app.states.get("animate")?.api ?? null);

  // ============================================================
  // 3. 自動保存
  // ============================================================
  // 「何も変わっていない」ことを安く確かめるための軽い指紋（数字と短い文字列だけ。巨大な JSON は触らない）。
  // 編集のたびに Undo 履歴が1件増える（またはシンボル・フレーム・画像が変わる）ので、これが同じなら中身も同じとみなせる…
  // ただしドラッグ中の編集は Undo 履歴が増えないので、ポインタを離した・キー入力・入力欄の変更では「確実に変化あり」の印（strong）を立てる。
  const light = () => {
    const a = refreshA();
    return a?.anim && a.map && a.img?.naturalWidth
      ? [a.anUndo?.length, a.anRedo?.length, a.symbol, Number(document.getElementById("frame")?.value) || 0, a.img.src, a.pngFileName].join("|")
      : null;
  };
  let lastLight = null, // 最後に保存した時点の軽い指紋
    strong = true; // 「確実に変化したかも」の印。起動後の最初の1回は確認する
  // sig(): 今の編集状態の「指紋」（JSON文字列）。前回保存したものと同じなら保存を省く。まだ何も読み込んでいなければ null。
  // 重い処理（Animation.json / spritemap 全体の JSON 化）なので、変化があり得るときだけ呼び、結果は保存にも使い回す。
  const sig = () => {
    if (!light()) return null;
    const animStr = JSON.stringify(A.anim),
      mapStr = JSON.stringify(A.map);
    return { animStr, mapStr, text: [animStr, mapStr, A.pngFileName, A.img.src, A.symbol, Number(document.getElementById("frame")?.value) || 0].join("\u0000") };
  };
  // 保存の本体。force=true は「今すぐ保存」（変化が無くても保存する）。
  // 保存中に呼ばれたら pending を立てておき、終わったあとで1回だけやり直す。
  // 画像は blob（バイナリ）のまま保存する（fetch(img.src) で取り出す）。
  async function saveLocal(force = false) {
    if (writing) {
      pending = true;
      return;
    }
    if (!force && !strong && light() === lastLight) return; // 変化なし（重い JSON 化をしない）
    const cur = light();
    const parts = sig();
    if (!parts) {
      if (force) update("先にAnimateAtlasを読み込んでください");
      return;
    }
    strong = false;
    lastLight = cur;
    const signature = parts.text;
    if (!force && signature === lastSignature) return;
    writing = true;
    try {
      // Preserve the original PNG or the rebuilt atlas image as binary, not a cookie.
      const response = await fetch(A.img.src);
      if (!response.ok) throw Error("Atlas image unavailable");
      const blob = await response.blob();
      const data = {
        anim: parts.animStr, // 変化の判定で作った文字列を、そのまま保存にも使う
        map: parts.mapStr,
        image: blob,
        pngFileName: A.pngFileName,
        symbol: A.symbol,
        frame: Number(document.getElementById("frame")?.value) || 0,
        updated: Date.now(),
      };
      await put(data);
      lastSignature = signature;
      lastSaved = data.updated;
      update("自動保存済み: " + new Date(lastSaved).toLocaleTimeString());
    } catch (e) {
      update("保存失敗: " + e.message);
    } finally {
      writing = false;
      if (pending) {
        pending = false;
        saveLocal();
      }
    }
  }

  // ============================================================
  // 4. 復元
  // ============================================================
  // 保存データから状態を作り直す: 画像と JSON をエディタへ戻し、シンボル一覧・スプライト一覧・タイムライン・プレビューを再構築する。
  // Undo 履歴は空にする。いま開いているデータがあるときは、置き換えてよいか確認する。
  async function restoreLocal() {
    try {
      const data = await get();
      if (!data) {
        update("復元できる作業はありません");
        return;
      }
      if (refreshA()?.anim && !confirm("現在のAnimateAtlasを前回の作業で置き換えますか？")) return;
      const newImg = new Image();
      const url = URL.createObjectURL(data.image);
      newImg.src = url;
      await newImg.decode();
      // エディタ画面が無ければここで作られる（persistent なので、以後は使い回される）
      await app.switchTo("animate");
      if (!refreshA()) throw Error("Animate Editor を開けませんでした");
      A.anim = JSON.parse(data.anim);
      A.map = JSON.parse(data.map);
      A.img = newImg;
      A.pngFileName = data.pngFileName || "spritemap1.png";
      A.symbol = data.symbol || "__AN__";
      A.symbolNavStack.length = 0;
      A.anUndo.length = 0;
      A.anRedo.length = 0;
      A.anButtons();
      const options = A.animateSymbolOptions();
      document.getElementById("symbol").innerHTML = options
        .map((o) => `<option value="${A.esc(o.name)}">${A.esc(o.label)}</option>`)
        .join("");
      if (!options.some((o) => o.name === A.symbol)) A.symbol = "__AN__";
      document.getElementById("symbol").value = A.symbol;
      document.getElementById("sprite").innerHTML = (A.map.ATLAS?.SPRITES || [])
        .map((x) => x.SPRITE)
        .map((s) => `<option value="${A.esc(s.name)}">${A.esc(s.name)}</option>`)
        .join("");
      A.updateAddSpriteList();
      document.getElementById("timeline").max = Math.max(0, A.duration(A.symbol) - 1);
      document.getElementById("frame").max = document.getElementById("timeline").max;
      A.setFrame(Math.min(data.frame, Math.max(0, A.duration(A.symbol) - 1)));
      A.parts();
      A.updateKeyUI();
      A.resize();
      A.recenterPreview();
      A.frameLabelRefresh();
      A.legacyEditRefresh();
      lastSignature = sig()?.text ?? "";
      lastLight = light();
      update("復元しました: " + new Date(data.updated).toLocaleString());
    } catch (e) {
      update("復元失敗: " + e.message);
    }
  }
  // パネルのボタン: 復元 / 今すぐ保存 / 復元データを削除 / 閉じる
  panel.querySelector("#fsRecover").onclick = restoreLocal;
  panel.querySelector("#fsSaveNow").onclick = () => saveLocal(true);
  panel.querySelector("#fsForget").onclick = async () => {
    if (!confirm("ローカル復元データを削除しますか？")) return;
    try {
      await drop();
      lastSignature = "";
      lastLight = null;
      strong = true;
      update("復元データを削除しました");
    } catch (e) {
      update("削除失敗: " + e.message);
    }
  };
  panel.querySelector("#fsHideRecovery").onclick = () => (panel.hidden = true);
  // Autosave after edits, including pointer drags and JSON modifications.

  // ============================================================
  // 5. 自動保存のきっかけ
  // ============================================================
  // 画面が見えているときは4秒ごと、タブが隠れたとき、ページを離れるときに saveLocal() を呼ぶ。
  // 内容が前回と同じなら saveLocal の中で何もしないので、頻繁に呼んでも問題ない。
  // 保存の判断は、ポインタを押している間（ドラッグ中）は見送り、ブラウザが手すきのとき（requestIdleCallback）に行う。
  //   → 以前は4秒ごとに巨大な JSON を丸ごと文字列化していて、大きなアトラスを開いていると周期的に画面が固まった。
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 50));
  let pointerDown = false;
  document.addEventListener("pointerdown", () => (pointerDown = true), true);
  document.addEventListener(
    "pointerup",
    () => {
      pointerDown = false;
      strong = true;
    },
    true,
  );
  for (const ev of ["keyup", "input", "change", "drop"]) document.addEventListener(ev, () => (strong = true), true);
  setInterval(() => {
    if (document.hidden || pointerDown) return;
    idle(() => saveLocal());
  }, 4000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveLocal();
  });
  window.addEventListener("pagehide", () => {
    saveLocal();
  });
  // 起動時: 前回の保存データがあるかを確認して、パネルに表示する
  get()
    .then((data) =>
      update(
        data
          ? "前回の作業あり: " + new Date(data.updated).toLocaleString() + "。復元できます。"
          : "復元データなし。編集後は約4秒ごとに自動保存します。",
      ),
    )
    .catch((e) => update("この環境では自動保存できません: " + e.message));
}
