/* ============================================================
   core/EventBus.js — 画面どうしが「直接つながらず」に話すための伝言板
   ------------------------------------------------------------
   Haxe の FlxSignal / Signal、または Codename の EventManager に近い。
   使い方:
     const off = bus.on("language-changed", (lang) => { ... });   // 登録（解除用の関数が返る）
     bus.emit("language-changed", "en");                           // 発火（引数は何個でもOK）
     off();                                                        // 解除

   なぜ必要？
     旧コードは window.xxx = ... という「誰からでも見えるグローバル変数」で画面どうしをつないでいた。
     これだと「どのファイルが何に依存しているか」が見えない。
     イベントバスなら、名前付きの合図だけを共有するので依存が目に見える。

   JS メモ:
     ・`#handlers` の # は「プライベートフィールド」。クラスの外からは触れない（Haxe の private var 相当）。
     ・Map は Haxe の Map<String, T> とほぼ同じ。
   ============================================================ */
export class EventBus {
  #handlers = new Map(); // イベント名 → Set<関数>

  on(name, fn) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    this.#handlers.get(name).add(fn);
    // 解除関数を返しておくと、呼ぶ側が fn を覚えておかなくて済む
    return () => this.off(name, fn);
  }

  off(name, fn) {
    this.#handlers.get(name)?.delete(fn); // ?. は「null/undefined なら何もしない」(optional chaining)
  }

  emit(name, ...args) {
    // [...set] でコピーしてから回す: 実行中に on/off されても安全
    for (const fn of [...(this.#handlers.get(name) ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        // 1つのハンドラが落ちても、他のハンドラは動かし続ける
        console.error(`[EventBus] "${name}" handler failed`, e);
      }
    }
  }
}
