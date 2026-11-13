/* ============================================================
   ui/ModPicker.js — 各エディタに置く「読み込み済みの mod から選ぶ」欄
   ------------------------------------------------------------
   ホームで読み込んだ mod（app.workspace）の中身を一覧にし、選んだものを
   そのエディタの既存の <input type=file> に流し込んで、いつもの「読み込む」処理を動かす。
   → エディタ側のロジックは変えずに、全エディタでアセットを共有できる。
   使い方: mountModPicker(state, hostEl, { title, list(ws) → [{label, files:{inputId: File}}], run(): 読み込みボタンを押す関数 })
   ============================================================ */
import { infoOf } from "../services/ModPack.js";

export function mountModPicker(state, host, spec) {
  const ws = state.app.workspace;
  const box = document.createElement("details");
  box.className = "modPicker";
  box.innerHTML = `<summary>${spec.title || "読み込み済みの mod から選ぶ"}</summary>
    <div class="row"><select class="mpSel"></select><button type="button" class="mpGo primary">これを開く</button></div>
    <p class="tiny mpInfo"></p>`;
  host.prepend(box);
  const sel = box.querySelector(".mpSel"),
    info = box.querySelector(".mpInfo");
  let items = [];
  const render = () => {
    items = ws.size ? spec.list(ws) : [];
    box.hidden = !ws.size;
    sel.textContent = "";
    items.forEach((it, i) => sel.append(new Option(it.label, String(i))));
    info.textContent = items.length ? `${items.length} 件。ホーム画面で読み込んだ mod から探しています。` : ws.size ? "この種類のファイルは見つかりませんでした。" : "";
  };
  box.querySelector(".mpGo").onclick = async () => {
    const it = items[Number(sel.value)];
    if (!it) return;
    try {
      for (const [id, v] of Object.entries(it.files)) {
        const dt = new DataTransfer();
        for (const f of [].concat(v)) {
          const real = await ws.toFile(f);
          if (real === f) {
            dt.items.add(f);
          } else dt.items.add(real);
          // zip 由来で File を作り直すと元のパスが消えるので、同じ mod を優先して探すための目印を付ける
          try {
            const tf = dt.files[dt.files.length - 1];
            Object.defineProperty(tf, "__origin", { value: infoOf(f).origin });
            Object.defineProperty(tf, "__path", { value: infoOf(f).noExt + (f.name.match(/\.[^.]+$/)?.[0] ?? "") }); // mod 内のパス（images/… など）
          } catch {}
        }
        const input = state.root.querySelector("#" + id);
        input.files = dt.files;
        if (spec.fire?.includes(id)) {
          input.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((r) => setTimeout(r, spec.wait ?? 300));
        }
      }
      await spec.run?.(it);
    } catch (e) {
      info.textContent = "⚠ " + e.message;
    }
  };
  const off = state.app.events.on("workspace:changed", render);
  state.addDisposer?.(() => off?.());
  render();
  return { render };
}
