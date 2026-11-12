/* ============================================================
   chart/scriptEvents.js — HScript（.hxc）から「イベントのスキーマ」と「ノーツ kind」を読み取る
   ------------------------------------------------------------
   ゲームのように HScript を実行するのではなく、ソースを字句解析して、次の形だけを取り出す（実行はしない）:
     ・class X extends SongEvent … super('ID') / getTitle() の戻り値 / getEventSchema() が返すリテラル
         [{ name:'a', title:'A', defaultValue:1, type:'float', ... }]   または   new SongEventSchema([ {…} ])
         type は 'enum' のような文字列でも SongEventFieldType.ENUM でもよい。keys: ['表示' => '値', …] を選択肢にする
     ・class X extends ScriptedNoteKind … super('id', '表示名')
   読み取れないもの（関数で選択肢を作る enum など）は、文字列の入力欄にして警告を出す。
   ============================================================ */

/** コメントを消す（文字列の中の // は消さない）。位置がずれないよう、改行は残す */
function stripComments(src) {
  let out = "",
    i = 0,
    q = null;
  while (i < src.length) {
    const c = src[i],
      n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === q) q = null;
      i++;
    } else if (c === '"' || c === "'") {
      q = c;
      out += c;
      i++;
    } else if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else out += src[i++];
  }
  return out;
}

/** open 位置（"{" や "("）の対応する閉じ括弧の位置。文字列は飛ばす */
function matchClose(s, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const o = s[open],
    c = pairs[o];
  let depth = 0,
    q = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

// ---- リテラルの小さなパーサ ----
class Lit {
  constructor(s, i = 0) {
    this.s = s;
    this.i = i;
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(t) {
    this.ws();
    if (this.s.startsWith(t, this.i)) {
      this.i += t.length;
      return true;
    }
    return false;
  }
  value() {
    const c = this.peek();
    if (c === "{") return this.object();
    if (c === "[") return this.arrayOrMap();
    if (c === '"' || c === "'") return this.string();
    if (/[-\d.]/.test(c ?? "")) {
      const m = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(this.s.slice(this.i));
      if (m) {
        this.i += m[0].length;
        return Number(m[0]);
      }
    }
    const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`読み取れない記述: ${this.s.slice(this.i, this.i + 20)}`);
    this.i += m[0].length;
    const id = m[0];
    if (id === "true") return true;
    if (id === "false") return false;
    if (id === "null") return null;
    if (id === "new") {
      this.ws();
      const m2 = /^[A-Za-z_$][\w$.<>]*/.exec(this.s.slice(this.i));
      this.i += m2 ? m2[0].length : 0;
    }
    if (this.peek() === "(") {
      const close = matchClose(this.s, this.i);
      const inner = this.s.slice(this.i + 1, close).trim();
      this.i = close + 1;
      // new SongEventSchema([...]) のように中身が1つのリテラルならそれを返す。関数呼び出しは「計算が必要」の印にする
      if (id === "new" && inner) {
        try {
          return new Lit(inner).value();
        } catch {
          return { call: inner };
        }
      }
      return { call: id };
    }
    return { ident: id };
  }
  string() {
    const q = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length && this.s[this.i] !== q) {
      let c = this.s[this.i++];
      if (c === "\\") {
        const n = this.s[this.i++];
        c = n === "n" ? "\n" : n === "t" ? "\t" : n;
      }
      out += c;
    }
    this.i++;
    return out;
  }
  object() {
    this.eat("{");
    const o = {};
    while (this.peek() !== "}") {
      if (this.i >= this.s.length) throw new Error("} が見つかりません");
      this.ws();
      let key;
      if (this.peek() === '"' || this.peek() === "'") key = this.string();
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
        if (!m) throw new Error("キー名を読めません");
        key = m[0];
        this.i += key.length;
      }
      if (!this.eat(":")) throw new Error(`: がありません (${key})`);
      o[key] = this.value();
      this.eat(",");
    }
    this.eat("}");
    return o;
  }
  arrayOrMap() {
    this.eat("[");
    const items = [],
      pairs = [];
    let isMap = false;
    while (this.peek() !== "]") {
      if (this.i >= this.s.length) throw new Error("] が見つかりません");
      const v = this.value();
      if (this.eat("=>")) {
        isMap = true;
        pairs.push([v, this.value()]);
      } else items.push(v);
      this.eat(",");
    }
    this.eat("]");
    return isMap ? { map: pairs } : items;
  }
}

const TYPE_ALIAS = { integer: "int", int: "int", float: "float", string: "string", bool: "bool", boolean: "bool", enum: "enum", frame: "frame" };

/** スキーマのリテラル（配列）→ フォーム用のフィールド一覧 */
function toFields(list, warnings, group) {
  const fields = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f !== "object" || typeof f.name !== "string") continue;
    let t = f.type;
    if (t && typeof t === "object") t = t.ident ? t.ident.split(".").pop() : "string";
    t = TYPE_ALIAS[String(t ?? "string").toLowerCase()] ?? "string";
    if (t === "frame") {
      fields.push(...toFields(f.children, warnings, f.name));
      continue;
    }
    const field = { name: f.name, title: typeof f.title === "string" ? f.title : f.name, type: t };
    if (group) field.group = group;
    for (const k of ["step", "min", "max"]) if (typeof f[k] === "number") field[k] = f[k];
    if (typeof f.units === "string") field.units = f.units;
    let def = f.defaultValue;
    if (def && typeof def === "object") def = undefined; // 定数の参照などは分からない
    if (t === "enum") {
      if (f.keys?.map) field.options = f.keys.map.map(([k, v]) => [String(k), typeof v === "object" ? String(v?.ident ?? "") : v]);
      else {
        field.type = "string";
        field.dynamic = true; // 候補は実行時に決まる（キャラ ID など）→ 入力欄 + 候補リスト
        warnings.push(`「${f.name}」の選択肢は関数で作られるため、文字列の入力欄にしました。`);
      }
    }
    if (field.type === "enum") def = def ?? field.options[0]?.[1];
    field.def = def ?? (field.type === "bool" ? false : field.type === "string" ? "" : 0);
    fields.push(field);
  }
  return fields;
}

/** .hxc のソース → { events, noteKinds, warnings } */
export function parseHxc(srcRaw) {
  const src = stripComments(srcRaw);
  const result = { events: [], noteKinds: [], warnings: [] };
  const classRe = /class\s+(\w+)\s+extends\s+(SongEvent|ScriptedSongEvent|ScriptedNoteKind)\b[^{]*\{/g;
  let m;
  while ((m = classRe.exec(src))) {
    const open = m.index + m[0].length - 1,
      close = matchClose(src, open);
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    classRe.lastIndex = close;
    const sup = /super\s*\(\s*(['"])(.*?)\1(?:\s*,\s*(['"])(.*?)\3)?/.exec(body);
    if (!sup) {
      result.warnings.push(`${m[1]}: super('ID') が見つかりません`);
      continue;
    }
    if (m[2] === "ScriptedNoteKind") {
      result.noteKinds.push({ id: sup[2], title: sup[4] ?? sup[2] });
      continue;
    }
    const ev = { id: sup[2], className: m[1], title: sup[2], fields: [], warnings: [] };
    const tm = /function\s+getTitle\s*\([^)]*\)[^{]*\{\s*return\s+(['"])(.*?)\1/.exec(body);
    if (tm) ev.title = tm[2];
    const sm = /function\s+getEventSchema\s*\([^)]*\)[^{]*\{/.exec(body);
    if (sm) {
      const sOpen = sm.index + sm[0].length - 1,
        sClose = matchClose(body, sOpen);
      const sBody = body.slice(sOpen + 1, sClose);
      const rm = /\breturn\b/.exec(sBody);
      try {
        if (!rm) throw new Error("return が見つかりません");
        const lit = new Lit(sBody, rm.index + rm[0].length).value();
        ev.fields = toFields(Array.isArray(lit) ? lit : [], ev.warnings);
      } catch (e) {
        ev.warnings.push(`スキーマを読めませんでした（${e.message}）。value を JSON で編集してください。`);
      }
    } else ev.warnings.push("getEventSchema が無いので、value を JSON で編集します。");
    result.events.push(ev);
  }
  return result;
}
