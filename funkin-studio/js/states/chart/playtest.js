/* ============================================================
   chart/playtest.js — Chart のプレイテスト（音ズレ・譜面の難しさの確認用）
   ------------------------------------------------------------
   ・編集中の難易度のノーツを、実際に叩いて遊べる（キーは既定で D F J K = 左 下 上 右。変更可）。
   ・判定は V-Slice の PBOT1（sick ≤45ms / good ≤90 / bad ≤135 / shit ≤160 / それ以上は miss）。スコア式も同じ。
   ・ノーツの流れる速さは V-Slice と同じ（0.45 px/ms × scrollSpeed、720p 基準）。ScrollSpeed イベントも反映（イージングは直線で近似）。
   ・入力時刻はキー押下の timeStamp から求めるので、描画フレームのズレに左右されない。
   ・音ズレ調整: 「入力オフセット」。結果画面に平均ズレ（+ は遅い）とヒストグラムが出て、補正値の提案ボタンがある。
   ・ホールドは押し続ける必要がある（終わる 160ms 前までに離すとドロップ）。相手側ノーツは自動で叩かれる。
   ・スマホは画面タップ（プレイヤー側の4レーン）で叩ける。
   ============================================================ */
import { Runtime } from "../../runtime/runtime.js";
import { openModZip } from "../../services/ModPack.js";
import { StageScene } from "../../runtime/stageScene.js";
const PIXELS_PER_MS = 0.45;
const WIN = { sick: 45, good: 90, bad: 135, shit: 160 };
const NOTE_COLORS = ["#c24b99", "#00ffff", "#12fa05", "#f9393f"];
const JUDGE_COLORS = { sick: "#7fe8ff", good: "#8dff8d", bad: "#ffd36b", shit: "#ff8f6b", miss: "#ff5577" };
const LS_KEY = "funkinStudio.chart.playtest";
const DEFAULTS = { startFrom: "playhead", speedMul: 1, down: false, showOpp: true, bot: false, hit: true, offset: 0, rate: 1, skin: "", scripts: true, scene: true, keys: ["KeyD", "KeyF", "KeyJ", "KeyK"] };

const scoreNote = (ms) => {
  const a = Math.abs(ms);
  if (a > 160) return -100;
  if (a < 5) return 500;
  return Math.floor(500 * (1 - 1 / (1 + Math.exp(-0.08 * (a - 54.99)))) + 9);
};
const judge = (ms) => {
  const a = Math.abs(ms);
  return a <= WIN.sick ? "sick" : a <= WIN.good ? "good" : a <= WIN.bad ? "bad" : a <= WIN.shit ? "shit" : "miss";
};
const keyLabel = (code) => code.replace(/^Key|^Digit/, "");
const codeOf = (ch) => (/^[a-z]$/i.test(ch) ? "Key" + ch.toUpperCase() : /^\d$/.test(ch) ? "Digit" + ch : null);

/**
 * @param root 画面のルート（#chartWorkspace）
 * @param d { audio, getNotes, getEvents, getTiming, getBaseSpeed, listen(target, type, fn), say,
 *            noteStyles（ノートスキンの集まり）, getScripts()（読み込み済みの .hxc テキスト {名前: テキスト}）, getCharacters() }
 */
export function createPlayTest(root, d) {
  const $ = (id) => document.getElementById(id);
  const wrap = $("chtPlayRoot"),
    canvas = $("chtPlayCanvas"),
    mainCtx = canvas.getContext("2d"),
    card = $("chtPlayCard"),
    hist = $("chtPlayHist");

  let ctx = mainCtx; // 描き先（フィルターのあるカメラでは一時的にそのカメラのキャンバスに替わる）
  let scene = null; // ステージとキャラクター（開始のたびに読み込む）
  let loadToken = 0;
  let rt = null; // 演出スクリプトの実行環境（開始のたびに作り直す）
  let evQueue = [],
    evIdx = 0,
    lastFrameAt = 0;
  let opts = { ...DEFAULTS };
  try {
    opts = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
    if (!Array.isArray(opts.keys) || opts.keys.length !== 4) opts.keys = DEFAULTS.keys.slice();
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(opts));
    } catch {}
  };

  let state = "closed"; // closed / menu / playing / paused / results
  let playhead = 0,
    notes = [],
    speedEvents = [],
    st = null,
    raf = 0;
  const keyDown = [false, false, false, false],
    flash = [0, 0, 0, 0],
    oppFlash = [0, 0, 0, 0];
  let popups = [],
    errTicks = [],
    prevRate = 1;

  // ---------------- オプション欄 ----------------
  const optEls = {
    startFrom: $("chtPlayStartFrom"),
    speedMul: $("chtPlaySpeed"),
    down: $("chtPlayDown"),
    showOpp: $("chtPlayOpp"),
    bot: $("chtPlayBot"),
    hit: $("chtPlayHit"),
    offset: $("chtPlayOffset"),
    rate: $("chtPlayRate"),
    skin: $("chtPlaySkin"),
    scripts: $("chtPlayScripts"),
    scene: $("chtPlayScene"),
  };
  const keyEls = [0, 1, 2, 3].map((i) => $("chtPlayKey" + i));
  function fillSkins() {
    const sel = optEls.skin;
    sel.textContent = "";
    sel.append(new Option("標準の矢印（スキンなし）", ""));
    for (const id of d.noteStyles.ids()) sel.append(new Option(id, id));
    if (![...sel.options].some((o) => o.value === opts.skin)) opts.skin = "";
  }
  function fillOpts() {
    fillSkins();
    for (const [k, el] of Object.entries(optEls)) {
      if (el.type === "checkbox") el.checked = !!opts[k];
      else el.value = opts[k];
    }
    keyEls.forEach((el, i) => (el.value = keyLabel(opts.keys[i])));
  }
  function readOpts() {
    for (const [k, el] of Object.entries(optEls)) {
      if (el.type === "checkbox") opts[k] = el.checked;
      else if (el.type === "number" || k === "rate") opts[k] = Number(el.value) || (k === "offset" ? 0 : 1);
      else opts[k] = el.value;
    }
    opts.speedMul = Math.max(0.1, opts.speedMul);
    keyEls.forEach((el, i) => {
      const c = codeOf(el.value.trim().slice(-1));
      if (c) opts.keys[i] = c;
      el.value = keyLabel(opts.keys[i]);
    });
    save();
  }
  for (const el of [...Object.values(optEls), ...keyEls]) el.addEventListener("change", readOpts);

  // ---------------- 譜面の統計（メニューに表示） ----------------
  function chartInfo() {
    const list = d.getNotes().filter((n) => n.d < 4);
    if (!list.length) return "この難易度にはプレイヤー側のノーツがありません。";
    const first = list[0].t,
      last = list[list.length - 1].t;
    const sec = Math.max(1, (last - first) / 1000);
    let peak = 0,
      j = 0;
    for (let i = 0; i < list.length; i++) {
      while (list[i].t - list[j].t > 1000) j++;
      peak = Math.max(peak, i - j + 1);
    }
    const holds = list.filter((n) => n.l > 0).length;
    const chords = list.filter((n, i) => i > 0 && Math.abs(list[i - 1].t - n.t) < 2).length;
    return `プレイヤー側 ${list.length} ノーツ（ホールド ${holds}・同時押し ${chords}）　平均 ${(list.length / sec).toFixed(1)} 個/秒　最大 ${peak} 個/秒　scrollSpeed ${d.getBaseSpeed()}`;
  }

  // ---------------- 開く・閉じる ----------------
  function open(playheadMs) {
    playhead = playheadMs;
    wrap.hidden = false;
    state = "menu";
    prevRate = d.audio.rate;
    fillOpts();
    showCard("プレイテスト", { info: chartInfo(), opts: true, go: "開始", restart: false });
    resize();
    loop();
  }
  function close() {
    if (state === "closed") return;
    loadToken++;
    rt?.songEnd();
    rt = null;
    d.audio.pause();
    d.audio.setRate(prevRate);
    state = "closed";
    wrap.hidden = true;
    cancelAnimationFrame(raf);
  }
  function showCard(title, { info = "", opts: showOpts = false, go = "", restart = false, hist: showHist = false, apply = false } = {}) {
    card.hidden = false;
    $("chtPlayTitle").textContent = title;
    $("chtPlayInfo").textContent = info;
    $("chtPlayOpts").hidden = !showOpts;
    hist.hidden = !showHist;
    $("chtPlayGo").textContent = go || "開始";
    $("chtPlayGo").hidden = !go;
    $("chtPlayRestart").hidden = !restart;
    $("chtPlayApply").hidden = !apply;
  }

  // ---------------- 開始 ----------------
  async function begin() {
    readOpts();
    const startMs = opts.startFrom === "playhead" ? playhead : 0;
    const timing = d.getTiming();
    notes = d
      .getNotes()
      .filter((n) => n.t >= startMs - 1)
      .map((n) => ({ t: n.t, l: n.l || 0, lane: n.d % 4, player: n.d < 4, hit: false, missed: false, holding: false, done: false, dropped: false }));
    speedEvents = d
      .getEvents()
      .filter((e) => e.e === "ScrollSpeed" && e.v)
      .map((e) => ({ t: e.t, scroll: Number(e.v.scroll ?? 1), dur: Math.max(0, timing.stepToMs(timing.msToStep(e.t) + Number(e.v.duration ?? 4)) - e.t), abs: !!e.v.absolute, who: e.v.strumline ?? "both" }))
      .sort((a, b) => a.t - b.t);
    const players = notes.filter((n) => n.player);
    st = {
      startMs,
      score: 0,
      combo: 0,
      maxCombo: 0,
      counts: { sick: 0, good: 0, bad: 0, shit: 0, miss: 0 },
      drops: 0,
      errors: [],
      total: players.length,
      end: Math.max(...notes.map((n) => n.t + n.l), startMs) + 1500,
      lastFrame: 0,
    };
    popups = [];
    errTicks = [];
    keyDown.fill(false);
    scene = null;
    if (opts.scene) {
      const tok = ++loadToken;
      state = "loading";
      showCard("読み込み中…", { info: "ステージとキャラクターを読み込んでいます" });
      scene = await loadScene();
      if (tok !== loadToken || state !== "loading") return; // 読み込み中に閉じた / 別の開始が走った
      scene.start(startMs);
    }
    startRuntime(startMs);
    d.audio.pause();
    d.audio.setRate(opts.rate);
    d.audio.seek(startMs - 2000 * opts.rate); // 2秒のカウントイン（負の時間は音が遅れて始まる）
    d.audio.play();
    state = "playing";
    card.hidden = true;
  }
  // ---------------- ステージとキャラクター ----------------
  async function loadScene() {
    const ws = d.getWorkspace?.();
    const sc = new StageScene({
      files: () => ws?.files ?? [],
      resolve: (kind, id, o) => ws?.resolve(kind, id, o) ?? null,
      origin: ws?.defaultOrigin?.(),
      timing: () => d.getTiming(),
      events: () => d.getEvents(),
    });
    try {
      await sc.load({ stage: d.getStage?.() ?? "", characters: d.getCharacters?.() });
    } catch (e) {
      sc.warn("ステージの読み込みで失敗しました: " + e.message);
    }
    if (!ws || !ws.files.length) sc.warn("mod が読み込まれていません（ホーム画面で mod の zip / フォルダを読み込むと、実際のステージとキャラが出ます）");
    return sc;
  }
  // ---------------- 演出スクリプト ----------------
  function startRuntime(startMs) {
    rt = null;
    evQueue = [];
    evIdx = 0;
    const scripts = Object.entries(d.getScripts?.() ?? {});
    const wantScripts = opts.scripts && scripts.length;
    const style = opts.skin ? d.noteStyles.get(opts.skin) : null;
    if (!wantScripts && !style) return; // 何も使わないなら実行環境は作らない（軽量）
    rt = new Runtime({ noteStyles: d.noteStyles, getOpts: () => opts, characters: d.getCharacters?.() });
    if (scene) rt.attachScene(scene);
    rt.ps.playerStrumline.noteStyle = style;
    rt.ps.opponentStrumline.noteStyle = style;
    if (!wantScripts) return;
    for (const [name, text] of scripts) rt.loadScript(text, name);
    const all = d
      .getEvents()
      .filter((e) => rt.hasEvent(e.e))
      .sort((a, b) => a.t - b.t);
    rt.songLoaded(all);
    rt.fireOld(all, startMs);
    evQueue = all.filter((e) => e.t >= startMs);
    rt.broadcast("onSongStart", {});
    lastFrameAt = performance.now();
  }
  const styleOf = (isPlayer) => (rt ? (isPlayer ? rt.ps.playerStrumline.noteStyle : rt.ps.opponentStrumline.noteStyle) : opts.skin ? d.noteStyles.get(opts.skin) : null);
  function scriptReport() {
    if (!rt && !scene) return "";
    const lines = [];
    if (scene?.warnings.length) lines.push("ℹ ステージ・キャラクター:\n  " + scene.warnings.join("\n  "));
    if (rt?.errors.length) lines.push("⚠ スクリプトのエラー:\n  " + rt.errors.join("\n  "));
    if (rt?.warnings.size) lines.push("ℹ 未対応のAPI（呼ばれたが再現していないもの）:\n  " + [...rt.warnings].slice(0, 12).join("\n  ") + (rt.warnings.size > 12 ? `\n  …ほか ${rt.warnings.size - 12} 件` : ""));
    return lines.join("\n");
  }
  function pause() {
    if (state !== "playing") return;
    rt?.pause();
    d.audio.pause();
    state = "paused";
    showCard("一時停止", { info: `スコア ${st.score}　コンボ ${st.combo}`, opts: true, go: "再開", restart: true });
  }
  function resume() {
    readOpts();
    d.audio.setRate(opts.rate);
    rt?.resume();
    lastFrameAt = performance.now();
    d.audio.seek(d.audio.position() - 1000); // 1秒戻してから再開（判定はまだ来ていないノーツだけ）
    d.audio.play();
    state = "playing";
    card.hidden = true;
  }
  // ---------------- ノートスキンの読み込み ----------------
  $("chtPlaySkinLoad").onclick = () => $("chtPlaySkinFiles").click();
  $("chtPlaySkinFiles").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const entries = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          // zip は中身を全部は読まない: 名前の一覧から、スキンの JSON・PNG・XML だけ取り出す
          for (const lf of await openModZip(f)) {
            if (/\.(json|xml|png)$/i.test(lf.name) && /(^|\/)(images|data)\//i.test(lf.webkitRelativePath)) entries.push({ name: lf.webkitRelativePath, file: lf });
          }
        } catch (err) {
          $("chtPlaySkinInfo").textContent = `${f.name}: ${err.message}`;
        }
      } else entries.push({ name: f.name, file: f });
    }
    const { added, warnings } = await d.noteStyles.addFiles(entries);
    fillSkins();
    if (added.length) {
      optEls.skin.value = opts.skin = added[0];
      save();
    }
    $("chtPlaySkinInfo").textContent = (added.length ? `読み込み: ${added.join(", ")}` : "ノートスキンの JSON が見つかりませんでした（notestyles の .json と、その画像 .png / .xml を一緒に選んでください）") + (warnings.length ? "\n" + warnings.join("\n") : "");
  };
  $("chtPlayGo").onclick = () => (state === "menu" || state === "results" ? begin() : state === "paused" ? resume() : 0);
  $("chtPlayRestart").onclick = () => begin();
  $("chtPlayExit").onclick = () => d.onExit?.();
  $("chtPlayPause").onclick = () => pause();
  $("chtPlayApply").onclick = () => {
    if (!st) return;
    const m = mean(st.errors);
    opts.offset = Math.round((opts.offset + m) * 10) / 10;
    save();
    fillOpts();
    d.say(`入力オフセットを ${opts.offset}ms にしました。もう一度遊んで、平均ズレが 0 に近づくか確かめてください。`);
    $("chtPlayApply").hidden = true;
  };

  // ---------------- 速度（ScrollSpeed イベント込み） ----------------
  function speedAt(t, side) {
    const base = d.getBaseSpeed() * opts.speedMul;
    let cur = base;
    for (const ev of speedEvents) {
      if (t < ev.t) break;
      if (ev.who !== "both" && ev.who !== side) continue;
      const target = ev.abs ? ev.scroll : base * ev.scroll;
      if (ev.dur <= 0 || t >= ev.t + ev.dur) cur = target;
      else {
        cur += (target - cur) * ((t - ev.t) / ev.dur);
        break;
      }
    }
    return cur;
  }

  // ---------------- 入力 ----------------
  const eff = (pos) => pos - opts.offset; // 入力オフセットを引いた「判定用の時刻」
  function press(lane, ts) {
    if (state !== "playing") return;
    keyDown[lane] = true;
    flash[lane] = 1;
    const pos = d.audio.position() - (performance.now() - ts) * d.audio.rate; // キーが押された瞬間の曲の位置
    const t = eff(pos);
    let target = null;
    for (const n of notes) {
      if (!n.player || n.hit || n.missed || n.lane !== lane) continue;
      const df = t - n.t;
      if (df < -WIN.shit) break; // まだ遠い（以降はもっと遠い）
      if (Math.abs(df) <= WIN.shit) {
        target = n;
        break;
      }
    }
    if (target) registerHit(target, t - target.t);
  }
  function release(lane) {
    keyDown[lane] = false;
  }
  function registerHit(n, diff) {
    const j = judge(diff);
    n.hit = true;
    st.counts[j]++;
    st.score += scoreNote(diff);
    st.errors.push(diff);
    if (j === "bad" || j === "shit") st.combo = 0;
    else st.combo++;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    popups.push({ text: j.toUpperCase(), sub: `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}ms`, color: JUDGE_COLORS[j], at: performance.now() });
    errTicks.push({ diff, color: JUDGE_COLORS[j], at: performance.now() });
    scene?.sing("player", n.lane);
    if (n.l > 0) n.holding = true;
    else n.done = true;
    if (opts.hit) d.audio.tick(false);
  }
  d.listen(window, "keydown", (e) => {
    if (state === "closed") return;
    if (e.code === "Escape") {
      e.preventDefault();
      if (state === "playing") pause();
      else if (state === "paused") resume();
      return;
    }
    if (e.repeat) return;
    const lane = opts.keys.indexOf(e.code);
    if (lane >= 0 && state === "playing") {
      e.preventDefault();
      press(lane, e.timeStamp);
    } else if (state === "playing" && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
  });
  d.listen(window, "keyup", (e) => {
    if (state === "closed") return;
    const lane = opts.keys.indexOf(e.code);
    if (lane >= 0) release(lane);
  });
  // タッチ・マウス: プレイヤー側の4レーン
  const pointers = new Map();
  const laneAt = (x) => {
    const g = geom();
    return Math.max(0, Math.min(3, Math.floor((x - (g.playerX - 2 * g.laneW)) / g.laneW)));
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "playing") return;
    const r = canvas.getBoundingClientRect(),
      lane = laneAt(e.clientX - r.left);
    pointers.set(e.pointerId, lane);
    canvas.setPointerCapture?.(e.pointerId);
    press(lane, e.timeStamp);
  });
  const up = (e) => {
    if (pointers.has(e.pointerId)) (release(pointers.get(e.pointerId)), pointers.delete(e.pointerId));
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  // ---------------- 更新 ----------------
  function update(pos) {
    const t = eff(pos);
    for (const n of notes) {
      if (n.done) continue;
      if (!n.player) {
        // 相手側は自動
        if (!n.hit && pos >= n.t) {
          n.hit = true;
          oppFlash[n.lane] = 1;
          scene?.sing("opponent", n.lane);
          if (n.l <= 0) n.done = true;
          else n.holding = true;
        }
        if (n.holding) scene?.keepSinging("opponent");
        if (n.holding && pos >= n.t + n.l) n.done = true;
        continue;
      }
      if (opts.bot && !n.hit && !n.missed && t >= n.t) {
        registerHit(n, 0);
        flash[n.lane] = 1;
      }
      if (!n.hit && !n.missed && t - n.t > WIN.shit) {
        n.missed = true;
        st.counts.miss++;
        st.combo = 0;
        st.score += -100;
        popups.push({ text: "MISS", sub: "", color: JUDGE_COLORS.miss, at: performance.now() });
        scene?.sing("player", n.lane, true);
      }
      if (n.holding) {
        const held = opts.bot || keyDown[n.lane];
        if (held) scene?.keepSinging("player");
        if (opts.bot) flash[n.lane] = 1;
        if (t >= n.t + n.l) {
          n.holding = false;
          n.done = true;
          st.score += 0;
        } else if (!held) {
          n.holding = false;
          if (n.t + n.l - t <= WIN.shit) n.done = true; // 終わりかけで離した = 成功扱い
          else {
            n.dropped = true;
            n.done = true;
            st.drops++;
            st.combo = 0;
          }
        }
      }
    }
    // 終了判定
    if (pos >= st.end && !notes.some((n) => n.player && !n.done && !n.missed)) finish();
  }
  function finish() {
    d.audio.pause();
    rt?.songEnd();
    state = "results";
    const c = st.counts,
      n = st.total || 1;
    const acc = ((c.sick + c.good * 0.75 + c.bad * 0.5 + c.shit * 0.25) / n) * 100;
    const m = mean(st.errors),
      sd = Math.sqrt(mean(st.errors.map((x) => (x - m) ** 2)));
    const early = st.errors.filter((x) => x < 0).length;
    const hint = !st.errors.length ? "" : Math.abs(m) < 5 ? "　→ 平均ズレは小さく、入力オフセットはこのままで良さそうです。" : `　→ 平均 ${m > 0 ? "遅め" : "早め"} (${m >= 0 ? "+" : ""}${m.toFixed(1)}ms)。「ズレを補正」で入力オフセットに反映できます。`;
    showCard("結果", {
      info:
        `スコア ${st.score}　精度(目安) ${acc.toFixed(1)}%　最大コンボ ${st.maxCombo}\n` +
        `SICK ${c.sick}　GOOD ${c.good}　BAD ${c.bad}　SHIT ${c.shit}　MISS ${c.miss}　ホールド落ち ${st.drops}\n` +
        `ズレ 平均 ${m >= 0 ? "+" : ""}${m.toFixed(1)}ms　ばらつき(SD) ${sd.toFixed(1)}ms　早い ${early} / 遅い ${st.errors.length - early}` +
        hint +
        (scriptReport() ? "\n\n" + scriptReport() : ""),
      go: "もう一度",
      hist: true,
      apply: st.errors.length > 0 && Math.abs(m) >= 5,
    });
    drawHist();
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  function drawHist() {
    const g = hist.getContext("2d"),
      W = hist.width,
      H = hist.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#10141b";
    g.fillRect(0, 0, W, H);
    const bins = new Array(32).fill(0);
    for (const e of st.errors) bins[Math.max(0, Math.min(31, Math.floor((e + 160) / 10)))]++;
    const max = Math.max(1, ...bins);
    bins.forEach((v, i) => {
      const ms = i * 10 - 155;
      g.fillStyle = JUDGE_COLORS[judge(ms)];
      const h = (v / max) * (H - 18);
      g.fillRect((i * W) / 32 + 1, H - 14 - h, W / 32 - 2, h);
    });
    g.fillStyle = "#fff";
    g.fillRect(W / 2 - 1, 0, 2, H - 12);
    g.fillStyle = "#aab";
    g.font = "10px system-ui";
    g.textAlign = "left";
    g.fillText("早い −160ms", 2, H - 2);
    g.textAlign = "center";
    g.fillText("0", W / 2, H - 2);
    g.textAlign = "right";
    g.fillText("+160ms 遅い", W - 2, H - 2);
    const m = mean(st.errors);
    g.strokeStyle = "#ffb020";
    g.beginPath();
    g.moveTo(W / 2 + (m / 160) * (W / 2), 0);
    g.lineTo(W / 2 + (m / 160) * (W / 2), H - 12);
    g.stroke();
  }

  // ---------------- 描画 ----------------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  d.listen(window, "resize", () => state !== "closed" && resize());
  function geom() {
    const W = canvas.clientWidth,
      H = canvas.clientHeight,
      s = H / 720;
    const lw = Math.min(112 * s, W / (opts.showOpp ? 9.5 : 5));
    return { W, H, s, laneW: lw, playerX: opts.showOpp ? W * 0.7 : W * 0.5, oppX: W * 0.27, strumY: opts.down ? H - 130 * s : 110 * s };
  }
  function drawArrow(cx, cy, size, lane, color, alpha = 1, outline = true) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate([Math.PI, Math.PI / 2, -Math.PI / 2, 0][lane]);
    const a = size * 0.42;
    ctx.beginPath();
    ctx.moveTo(a * 1.1, 0);
    ctx.lineTo(-a * 0.2, -a);
    ctx.lineTo(-a * 0.2, -a * 0.4);
    ctx.lineTo(-a * 1.1, -a * 0.4);
    ctx.lineTo(-a * 1.1, a * 0.4);
    ctx.lineTo(-a * 0.2, a * 0.4);
    ctx.lineTo(-a * 0.2, a);
    ctx.closePath();
    if (outline) {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSide(g, x0, notesOf, side, pos, isPlayer) {
    const { laneW, strumY, s, H } = g;
    const dir = opts.down ? -1 : 1;
    const left = x0 - 2 * laneW;
    const style = styleOf(isPlayer);
    const sk = style && style.usable() ? style : null; // 絵が使えるスキンだけ
    const k = laneW / 112; // スキンの絵は「1 レーン = 112px」基準
    // レーン
    for (let l = 0; l < 4; l++) {
      const cx = left + (l + 0.5) * laneW;
      const fl = (isPlayer ? flash : oppFlash)[l];
      if (isPlayer && keyDown[l]) {
        ctx.fillStyle = "rgba(255,255,255,.08)";
        ctx.fillRect(cx - laneW / 2, 0, laneW, H);
      }
      const mode = fl > 0.05 ? "confirm" : isPlayer && keyDown[l] ? "press" : "static";
      if (!(sk && sk.drawStrum(ctx, l, mode, 1 - fl, cx, strumY, k))) drawArrow(cx, strumY, laneW * 0.85, l, fl > 0.05 ? NOTE_COLORS[l] : "rgba(255,255,255,.45)", 1, fl > 0.05);
      if (fl > 0) (isPlayer ? flash : oppFlash)[l] = Math.max(0, fl - 0.08);
    }
    const t = isPlayer ? eff(pos) : pos;
    const sp = speedAt(t, side) * PIXELS_PER_MS * s;
    for (const n of notesOf) {
      if (n.done && !n.holding) continue;
      const cx = left + (n.lane + 0.5) * laneW;
      let y = strumY + dir * (n.t - t) * sp;
      let yEnd = n.l > 0 ? strumY + dir * (n.t + n.l - t) * sp : y;
      if (n.holding) y = strumY;
      if (Math.max(y, yEnd) < -laneW || Math.min(y, yEnd) > H + laneW) continue;
      const missed = n.missed;
      const col = NOTE_COLORS[n.lane];
      if (n.l > 0) {
        const al = missed || n.dropped ? 0.25 : n.holding ? 0.95 : 0.7;
        if (!(sk && sk.drawHold(ctx, n.lane, cx, y, yEnd, k, al))) {
          const bw = laneW * 0.28;
          ctx.globalAlpha = al;
          ctx.fillStyle = col;
          const a = Math.min(y, yEnd),
            b = Math.max(y, yEnd);
          ctx.fillRect(cx - bw / 2, a, bw, b - a);
          ctx.globalAlpha = 1;
        }
      }
      if (!n.holding && !(sk && sk.drawNote(ctx, n.lane, cx, y, k, missed ? 0.3 : 1))) drawArrow(cx, y, laneW * 0.85, n.lane, col, missed ? 0.3 : 1);
    }
  }
  /** HUD（レーン・ノーツ・判定表示など）。ctx は呼び出し側が切り替えている */
  function drawHud(g, pos) {
    const { W, H, s } = g;
    // 相手側 → プレイヤー側
    const opp = notes.filter((n) => !n.player),
      pl = notes.filter((n) => n.player);
    if (opts.showOpp) drawSide(g, g.oppX, opp, "opponent", pos, false);
    drawSide(g, g.playerX, pl, "player", pos, true);
    // 判定の表示
    const now = performance.now();
    popups = popups.filter((p) => now - p.at < 700);
    const last = popups[popups.length - 1];
    if (last) {
      const a = 1 - (now - last.at) / 700;
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.textAlign = "center";
      ctx.fillStyle = last.color;
      ctx.font = `bold ${44 * s}px system-ui, sans-serif`;
      ctx.fillText(last.text, g.playerX, H / 2 - 20 * s);
      ctx.font = `${20 * s}px system-ui, sans-serif`;
      ctx.fillText(last.sub, g.playerX, H / 2 + 12 * s);
      ctx.globalAlpha = 1;
    }
    if (st.combo >= 2) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${54 * s}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(st.combo), g.playerX, H / 2 + 80 * s);
    }
  }
  /** スコア・ズレのバー・カウントなど（演出より手前に出す。カメラの外） */
  function drawOverlay(g, pos) {
    const { W, H, s } = g;
    const now = performance.now();
    // ズレのバー（下）
    const bw = Math.min(W * 0.5, 400),
      by = H - 44;
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fillRect(W / 2 - bw / 2, by, bw, 6);
    ctx.fillStyle = "#fff";
    ctx.fillRect(W / 2 - 1, by - 8, 2, 22);
    errTicks = errTicks.filter((e) => now - e.at < 2500);
    for (const e of errTicks) {
      ctx.globalAlpha = 1 - (now - e.at) / 2500;
      ctx.fillStyle = e.color;
      ctx.fillRect(W / 2 + (e.diff / 160) * (bw / 2) - 1.5, by - 6, 3, 18);
    }
    ctx.globalAlpha = 1;
    // 上の情報
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    const hits = st.counts.sick + st.counts.good + st.counts.bad + st.counts.shit;
    ctx.fillText(`Score ${st.score}   Miss ${st.counts.miss}   ${hits ? "平均ズレ " + (mean(st.errors) >= 0 ? "+" : "") + mean(st.errors).toFixed(1) + "ms" : ""}`, 12, 24);
    ctx.fillText(`${(Math.max(0, pos) / 1000).toFixed(1)}s / ${(st.end / 1000).toFixed(1)}s${opts.bot ? "   [BOT]" : ""}`, 12, 44);
    if (rt && (rt.errors.length || rt.warnings.size)) {
      ctx.fillStyle = rt.errors.length ? "#ff8f8f" : "#ffd36b";
      ctx.fillText(`スクリプト: エラー ${rt.errors.length} / 未対応API ${rt.warnings.size}（結果画面で確認）`, 12, 64);
    }
    if (pos < st.startMs) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd36b";
      ctx.font = `bold ${60 * s}px system-ui, sans-serif`;
      ctx.fillText(String(Math.ceil((st.startMs - pos) / 1000 / d.audio.rate)), W / 2, H / 2);
    }
    }
  function draw() {
    const g = geom(),
      { W, H } = g;
    const live = !!st && state !== "menu";
    const pos = live && (state === "playing" || state === "paused" || state === "results") ? d.audio.position() : 0;
    const bg = (c) => {
      c.fillStyle = "#0d1016";
      c.fillRect(0, 0, W, H);
    };
    if (live && rt && rt.hasContent()) {
      // スクリプトの表示物 / フィルターがあるときだけ、カメラごとに重ねて描く
      rt.render(mainCtx, W, H, window.devicePixelRatio || 1, {
        begin: (name, c) => {
          ctx = c;
          if (name === "camGame") (bg(c), scene?.draw(c, W, H));
          else if (name === "camHUD") drawHud(g, pos);
        },
      });
      ctx = mainCtx;
      drawOverlay(g, pos);
    } else {
      ctx = mainCtx;
      bg(ctx);
      if (scene && state !== "menu") scene.draw(ctx, W, H);
      if (live) {
        drawHud(g, pos);
        drawOverlay(g, pos);
      }
      else if (state === "menu") {
        // 見本のレーン
        drawSide(g, g.playerX, [], "player", 0, true);
        if (opts.showOpp) drawSide(g, g.oppX, [], "opponent", 0, false);
      }
    }
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    if (state === "playing") {
      const pos = d.audio.position();
      update(pos);
      {
        const now = performance.now();
        if (scene && !rt) {
          scene.update(Math.min(100, now - lastFrameAt) * d.audio.rate, pos);
          lastFrameAt = now;
        }
      }
      if (rt) {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastFrameAt) / 1000) * d.audio.rate;
        lastFrameAt = now;
        while (evIdx < evQueue.length && evQueue[evIdx].t <= pos) rt.fire(evQueue[evIdx++]);
        scene?.update(dt * 1000, pos);
        rt.update(dt, pos);
      }
    }
    draw();
  }

  return { open, close, isOpen: () => state !== "closed", pause };
}
