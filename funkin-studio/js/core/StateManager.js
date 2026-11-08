/* ============================================================
   core/StateManager.js — 画面の切り替え係（Haxe の FlxG.switchState 相当）
   ------------------------------------------------------------
   やること:
     1. register(StateClass)  … 画面クラスを登録（id → クラス の辞書に入れる）
     2. switchTo(id, params)  … 今の画面を片付けて、次の画面を作って見せる

   switchTo の流れ:
     ① 今の画面の canLeave() に「出てもいい？」と聞く（未保存の警告など）
     ② 今の画面を hide。persistent でなければ destroy して DOM から外す
     ③ 次の画面を取り出す（persistent で既にあれば使い回し、無ければ new → create）
     ④ 次の画面を show。HUD と <body> の見た目を合わせる
     ⑤ "state-changed" イベントを発火

   JS メモ:
     ・async / await … 「あとで終わる処理」を上から下へ読める形で書く仕組み。
       canLeave() が confirm() のような同期処理でも、Promise を返す非同期処理でも await で同じように待てる。
     ・Map … キーと値の辞書。Haxe の Map<String, Class<State>> と同じ。
   ============================================================ */
import { State } from "./State.js";

export class StateManager {
  #classes = new Map(); // id → StateClass
  #cache = new Map(); // id → 生きている persistent な State
  #busy = false; // 遷移中の二重呼び出し防止
  #rafId = 0;
  #lastTime = 0;

  /** 現在表示中の State（まだ無ければ null） */
  current = null;

  /** 生きている persistent な State を返す（まだ作られていなければ null）。例: states.get("animate")?.api */
  get(id) {
    return this.#cache.get(id) ?? null;
  }

  constructor(app, host) {
    this.app = app;
    this.host = host; // 画面の root を並べる親要素（#app）
  }

  register(...StateClasses) {
    for (const C of StateClasses) {
      if (!C.id) throw new Error(`State class "${C.name}" has no static id`);
      if (this.#classes.has(C.id)) throw new Error(`Duplicate state id: ${C.id}`);
      this.#classes.set(C.id, C);
    }
  }

  async switchTo(id, params = {}) {
    const Next = this.#classes.get(id);
    if (!Next) throw new Error(`Unknown state: ${id}`);
    if (this.#busy || this.current?.constructor === Next) return false;
    this.#busy = true;
    try {
      const prev = this.current;
      // ① 出てもいいか聞く
      if (prev && (await prev.canLeave(id)) === false) return false;

      // ② 今の画面を片付ける
      if (prev) {
        prev._hide();
        if (!prev.constructor.persistent) {
          prev._destroy();
        }
      }

      // ③ 次の画面を用意する
      let next = this.#cache.get(id);
      if (!next) {
        next = new Next(this.app);
        next._mount(this.host);
        if (Next.persistent) this.#cache.set(id, next);
      }

      // ④ 見せる
      this.current = next;
      document.body.dataset.screen = id;
      document.body.classList.toggle("editor-active", Next.hud);
      this.app.hud?.sync(Next);
      next._show(params);
      this.#syncLoop();

      // ⑤ 知らせる
      this.app.events.emit("state-changed", id, prev?.constructor.id ?? null);
      return true;
    } finally {
      this.#busy = false;
    }
  }

  // ---------------- update ループ ----------------
  // update(elapsed) を上書きしている画面があるときだけ、毎フレーム呼ぶ（requestAnimationFrame）。
  // 使わない画面では何も回さないので、省電力。
  #syncLoop() {
    const wants = this.current && this.current.update !== State.prototype.update;
    if (wants && !this.#rafId) {
      this.#lastTime = performance.now();
      const tick = (now) => {
        const elapsed = (now - this.#lastTime) / 1000; // 秒（FlxG.elapsed と同じ単位）
        this.#lastTime = now;
        this.current?.update(elapsed);
        this.#rafId = requestAnimationFrame(tick);
      };
      this.#rafId = requestAnimationFrame(tick);
    } else if (!wants && this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }
}
