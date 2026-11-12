/* ============================================================
   runtime/hscript.js — HScript（Haxe のサブセット）の軽量インタプリタ
   ------------------------------------------------------------
   ・.hxc のクラス定義（class X extends SongEvent / Module など）を読み込んで動かす。
   ・対応: import/using（無視）、class（extends・static・var・function・new）、
     var / final、if / for(in) / while / do-while / switch / try-catch / throw / return / break / continue、
     関数式 function(){} と (a,b)->x、匿名オブジェクト、配列、Map リテラル ['a'=>1]、配列内包 [for(..) ..]、
     文字列補間 'x=$x ${y}'、?? ?. ??= ... 範囲 a...b、new、cast、型注釈（読み飛ばし）。
   ・非対応: マクロ、プロパティの get/set、enum の引数付きパターン、正規表現リテラル。
     パースできない場合は行番号付きのエラーを出す。
   ・ホスト側（runtime.js）が globals（FlxG・PlayState など）と bases（SongEvent・Module）を渡す。
   ・知らない名前は「スタブ」（何を呼んでも落ちない代役）になり、未対応 API として記録される。
   ============================================================ */

export class HScriptError extends Error {}
class ThrowSignal {
  constructor(v) {
    this.value = v;
  }
}
const BRK = { sig: "brk" },
  CONT = { sig: "cont" };
class Ret {
  constructor(v) {
    this.sig = "ret";
    this.v = v;
  }
}

/** Haxe の Map（StringMap / IntMap / ObjectMap 共通） */
export class HMap {
  constructor() {
    this.m = new Map();
  }
  get(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  set(k, v) {
    this.m.set(k, v);
  }
  exists(k) {
    return this.m.has(k);
  }
  remove(k) {
    return this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  keys() {
    return [...this.m.keys()];
  }
  iterator() {
    return [...this.m.values()];
  }
  keyValueIterator() {
    return [...this.m.entries()].map(([key, value]) => ({ key, value }));
  }
  get length() {
    return this.m.size;
  }
}

// ---------------------------------------------------------------- 字句解析
const OPS = [">>>=", "<<=", ">>=", ">>>", "??=", "...", "=>", "->", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>"];
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdChar = (c) => /[A-Za-z0-9_$]/.test(c);

function lex(src) {
  const toks = [];
  let i = 0,
    line = 1;
  const n = src.length;
  const push = (t, v, extra) => toks.push({ t, v, line, ...extra });
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "#" && /^#(if|else|elseif|end)\b/.test(src.slice(i, i + 9))) {
      // 条件付きコンパイルは行ごと読み飛ばす（全部有効として扱うのは危険なので無視）
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i;
      if (c === "0" && /[xX]/.test(src[i + 1] || "")) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        push("num", parseInt(src.slice(i, j), 16));
      } else {
        while (j < n && /[0-9]/.test(src[j])) j++;
        if (src[j] === "." && src[j + 1] !== "." && /[0-9]/.test(src[j + 1] || "")) {
          j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        } else if (src[j] === "." && src[j + 1] !== "." && !isIdStart(src[j + 1] || " ")) j++; // "1." のような書き方
        if (/[eE]/.test(src[j] || "") && /[0-9+-]/.test(src[j + 1] || "")) {
          j += 2;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        push("num", parseFloat(src.slice(i, j)));
      }
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      push("id", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c,
        interp = c === "'";
      const startLine = line;
      let j = i + 1,
        buf = "";
      const parts = [];
      const flush = () => {
        if (buf) parts.push(buf);
        buf = "";
      };
      while (j < n && src[j] !== q) {
        let ch = src[j];
        if (ch === "\n") line++;
        if (ch === "\\") {
          const e = src[j + 1];
          j += 2;
          if (e === "n") buf += "\n";
          else if (e === "t") buf += "\t";
          else if (e === "r") buf += "\r";
          else if (e === "0") buf += "\0";
          else if (e === "x") {
            buf += String.fromCharCode(parseInt(src.slice(j, j + 2), 16));
            j += 2;
          } else if (e === "u") {
            buf += String.fromCharCode(parseInt(src.slice(j, j + 4), 16));
            j += 4;
          } else buf += e;
          continue;
        }
        if (interp && ch === "$") {
          if (src[j + 1] === "$") {
            buf += "$";
            j += 2;
            continue;
          }
          if (src[j + 1] === "{") {
            let depth = 1,
              k = j + 2;
            while (k < n && depth) {
              if (src[k] === "{") depth++;
              else if (src[k] === "}") depth--;
              k++;
            }
            flush();
            parts.push({ src: src.slice(j + 2, k - 1), line });
            j = k;
            continue;
          }
          if (isIdStart(src[j + 1] || " ")) {
            let k = j + 2;
            while (k < n && isIdChar(src[k])) k++;
            flush();
            parts.push({ src: src.slice(j + 1, k), line });
            j = k;
            continue;
          }
        }
        buf += ch;
        j++;
      }
      flush();
      i = j + 1;
      toks.push({ t: "str", v: parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts.length === 0 ? "" : null, parts, line: startLine });
      continue;
    }
    let op = OPS.find((o) => src.startsWith(o, i));
    if (!op) op = c;
    push("op", op);
    i += op.length;
  }
  push("eof", "");
  return toks;
}

// ---------------------------------------------------------------- 構文解析
const BIN = {
  "??": 3,
  "||": 4,
  "&&": 5,
  "...": 6,
  "==": 7,
  "!=": 7,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "|": 8,
  "&": 8,
  "^": 8,
  "<<": 9,
  ">>": 9,
  ">>>": 9,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
};
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "??="]);
const MODS = new Set(["public", "private", "static", "override", "inline", "final", "dynamic", "extern", "macro", "overload"]);

class Parser {
  constructor(src, baseLine = 0) {
    this.toks = lex(src);
    if (baseLine) for (const t of this.toks) t.line += baseLine - 1;
    this.p = 0;
  }
  get cur() {
    return this.toks[this.p];
  }
  peek(k = 1) {
    return this.toks[Math.min(this.p + k, this.toks.length - 1)];
  }
  err(msg) {
    const t = this.cur;
    throw new HScriptError(`構文エラー（${t.line} 行目）: ${msg}（「${t.t === "eof" ? "ファイル末尾" : t.v ?? "文字列"}」の付近）`);
  }
  is(v) {
    const t = this.cur;
    return t.t === "op" && t.v === v;
  }
  isId(v) {
    const t = this.cur;
    return t.t === "id" && t.v === v;
  }
  eat(v) {
    if (this.is(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  eatId(v) {
    if (this.isId(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expect(v) {
    if (!this.eat(v)) this.err(`「${v}」が必要です`);
  }
  ident() {
    const t = this.cur;
    if (t.t !== "id") this.err("名前が必要です");
    this.p++;
    return t.v;
  }

  // ---- ファイル全体
  parseModule() {
    const classes = [];
    while (this.cur.t !== "eof") {
      this.skipMeta();
      if (this.isId("import") || this.isId("using") || this.isId("package")) {
        while (!this.is(";") && this.cur.t !== "eof") this.p++;
        this.eat(";");
        continue;
      }
      let sawMod = false;
      while (this.cur.t === "id" && MODS.has(this.cur.v) && this.peek().t === "id") {
        this.p++;
        sawMod = true;
      }
      if (this.isId("class")) {
        classes.push(this.parseClass());
        continue;
      }
      if (this.isId("typedef") || this.isId("enum") || this.isId("abstract") || this.isId("interface")) {
        this.skipDecl();
        continue;
      }
      if (this.isId("function") || this.isId("var")) {
        // クラス外の関数・変数（HScript のスクリプトファイル形式）は非対応
        this.err("クラスの外の関数/変数は未対応です（class の中に書いてください）");
      }
      if (sawMod) continue;
      this.err("クラス定義が必要です");
    }
    return classes;
  }
  skipDecl() {
    while (!this.is("{") && !this.is(";") && this.cur.t !== "eof") this.p++;
    if (this.eat(";")) return;
    this.skipBraces();
  }
  skipBraces() {
    let depth = 0;
    do {
      if (this.is("{")) depth++;
      else if (this.is("}")) depth--;
      this.p++;
    } while (depth > 0 && this.cur.t !== "eof");
  }
  skipMeta() {
    while (this.is("@")) {
      this.p++;
      this.eat(":");
      this.ident();
      while (this.eat(".")) this.ident();
      if (this.is("(")) this.skipParens();
    }
  }
  skipParens() {
    let depth = 0;
    do {
      if (this.is("(")) depth++;
      else if (this.is(")")) depth--;
      this.p++;
    } while (depth > 0 && this.cur.t !== "eof");
  }
  /** 型注釈を読み飛ばす（Array<Dynamic> や String->Void など） */
  skipType() {
    if (this.eat("(")) {
      let depth = 1;
      while (depth && this.cur.t !== "eof") {
        if (this.is("(")) depth++;
        else if (this.is(")")) depth--;
        this.p++;
      }
    } else if (this.eat("{")) {
      this.p--;
      this.skipBraces();
    } else {
      this.eat("?");
      this.ident();
      while (this.eat(".")) this.ident();
      if (this.is("<")) {
        let depth = 0;
        do {
          if (this.is("<")) depth++;
          else if (this.is(">")) depth--;
          else if (this.is(">>")) depth -= 2;
          else if (this.is(">>>")) depth -= 3;
          else if (this.is(">=")) {
            // List<T>=x のように ">" と "=" がくっついた場合は "=" を残す
            this.toks[this.p] = { ...this.cur, v: "=" };
            depth--;
            if (depth <= 0) break;
            continue;
          }
          this.p++;
        } while (depth > 0 && this.cur.t !== "eof");
      }
    }
    if (this.eat("->")) this.skipType();
  }
  parseClass() {
    this.p++; // class
    const name = this.ident();
    if (this.is("<")) this.skipType2();
    let ext = null;
    while (this.isId("extends") || this.isId("implements")) {
      const isExt = this.cur.v === "extends";
      this.p++;
      let nm = this.ident();
      while (this.eat(".")) nm = this.ident();
      if (this.is("<")) this.skipType2();
      if (isExt) ext = nm;
    }
    this.expect("{");
    const cls = { name, ext, fields: [], methods: new Map(), statics: new Map(), ctor: null, line: this.cur.line };
    while (!this.is("}")) {
      if (this.cur.t === "eof") this.err("クラスが閉じていません");
      this.skipMeta();
      const mods = new Set();
      while (this.cur.t === "id" && MODS.has(this.cur.v)) {
        // "final x = 1;" は変数宣言。"final function" のときだけ修飾子
        if (this.cur.v === "final" && !(this.peek().t === "id" && (this.peek().v === "function" || MODS.has(this.peek().v)))) break;
        mods.add(this.toks[this.p++].v);
      }
      if (this.isId("var") || this.isId("final")) {
        this.p++;
        const fname = this.ident();
        if (this.is("(")) this.err("プロパティの get/set は未対応です");
        if (this.eat(":")) this.skipType();
        let init = null;
        if (this.eat("=")) init = this.parseExpr();
        this.eat(";");
        cls.fields.push({ name: fname, init, isStatic: mods.has("static") });
      } else if (this.isId("function")) {
        this.p++;
        const fname = this.ident();
        if (this.is("<")) this.skipType2();
        const params = this.parseParams();
        if (this.eat(":")) this.skipType();
        const body = this.parseBlock();
        const m = { name: fname, params, body, isStatic: mods.has("static"), isOverride: mods.has("override") };
        if (fname === "new") cls.ctor = m;
        else (m.isStatic ? cls.statics : cls.methods).set(fname, m);
      } else this.err("クラスの中は var / function だけ書けます");
    }
    this.expect("}");
    return cls;
  }
  skipType2() {
    let depth = 0;
    do {
      if (this.is("<")) depth++;
      else if (this.is(">")) depth--;
      else if (this.is(">>")) depth -= 2;
      else if (this.is(">=")) {
        this.toks[this.p] = { ...this.cur, v: "=" };
        depth--;
        if (depth <= 0) break;
        continue;
      }
      this.p++;
    } while (depth > 0 && this.cur.t !== "eof");
  }
  parseParams() {
    this.expect("(");
    const ps = [];
    while (!this.is(")")) {
      const opt = this.eat("?");
      const name = this.ident();
      if (this.eat(":")) this.skipType();
      let def = null;
      if (this.eat("=")) def = this.parseExpr();
      ps.push({ name, def, opt });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return ps;
  }

  // ---- 文
  parseBlock() {
    this.expect("{");
    const body = [];
    while (!this.is("}")) {
      if (this.cur.t === "eof") this.err("「}」が足りません");
      body.push(this.parseStmt());
    }
    this.expect("}");
    return { k: "block", body };
  }
  parseStmt() {
    const t = this.cur;
    const line = t.line;
    if (t.t === "op") {
      if (t.v === "{") return this.parseBlock();
      if (t.v === ";") {
        this.p++;
        return { k: "block", body: [] };
      }
      if (t.v === "@") {
        this.skipMeta();
        return this.parseStmt();
      }
    }
    if (t.t === "id") {
      switch (t.v) {
        case "var":
        case "final": {
          this.p++;
          const decls = [];
          do {
            const name = this.ident();
            if (this.eat(":")) this.skipType();
            let init = null;
            if (this.eat("=")) init = this.parseExpr();
            decls.push({ name, init });
          } while (this.eat(","));
          this.eat(";");
          return { k: "var", decls, line };
        }
        case "if": {
          this.p++;
          this.expect("(");
          const c = this.parseExpr();
          this.expect(")");
          const a = this.parseStmt();
          let b = null;
          if (this.eatId("else")) b = this.parseStmt();
          return { k: "if", c, a, b };
        }
        case "while": {
          this.p++;
          this.expect("(");
          const c = this.parseExpr();
          this.expect(")");
          return { k: "while", c, body: this.parseStmt() };
        }
        case "do": {
          this.p++;
          const body = this.parseStmt();
          if (!this.eatId("while")) this.err("do の後に while が必要です");
          this.expect("(");
          const c = this.parseExpr();
          this.expect(")");
          this.eat(";");
          return { k: "dowhile", c, body };
        }
        case "for": {
          this.p++;
          this.expect("(");
          let kn = null,
            vn = this.ident();
          if (this.eat("=>")) {
            kn = vn;
            vn = this.ident();
          }
          if (!this.eatId("in")) this.err("for の in が必要です");
          const it = this.parseExpr();
          this.expect(")");
          return { k: "for", kn, vn, it, body: this.parseStmt() };
        }
        case "return": {
          this.p++;
          let e = null;
          if (!this.is(";") && !this.is("}")) e = this.parseExpr();
          this.eat(";");
          return { k: "return", e };
        }
        case "break":
          this.p++;
          this.eat(";");
          return { k: "break" };
        case "continue":
          this.p++;
          this.eat(";");
          return { k: "continue" };
        case "throw": {
          this.p++;
          const e = this.parseExpr();
          this.eat(";");
          return { k: "throw", e };
        }
        case "try": {
          this.p++;
          const body = this.parseStmt();
          const catches = [];
          while (this.eatId("catch")) {
            this.expect("(");
            const name = this.ident();
            if (this.eat(":")) this.skipType();
            this.expect(")");
            catches.push({ name, body: this.parseStmt() });
          }
          return { k: "try", body, catches };
        }
        case "switch": {
          const e = this.parseSwitch();
          return { k: "expr", e, line };
        }
        case "function":
          if (this.peek().t === "id") {
            this.p++;
            const name = this.ident();
            const params = this.parseParams();
            if (this.eat(":")) this.skipType();
            const body = this.parseBlock();
            return { k: "var", decls: [{ name, init: { k: "func", params, body } }], line };
          }
      }
    }
    const e = this.parseExpr();
    if (!this.eat(";") && !this.is("}")) {
      // ブロックを末尾に持つ式（関数式など）の後は ; 省略可
      const prev = this.toks[this.p - 1];
      if (!(prev && prev.t === "op" && prev.v === "}")) this.err("「;」が必要です");
    }
    return { k: "expr", e, line };
  }
  parseSwitch() {
    this.p++; // switch
    this.expect("(");
    const e = this.parseExpr();
    this.expect(")");
    this.expect("{");
    const cases = [];
    while (!this.is("}")) {
      let pats = null,
        guard = null;
      if (this.eatId("default")) pats = null;
      else if (this.eatId("case")) {
        pats = [];
        do pats.push(this.parseBin(9));
        while (this.eat("|") || this.eat(","));
        if (this.eatId("if")) {
          this.expect("(");
          guard = this.parseExpr();
          this.expect(")");
        }
      } else this.err("case / default が必要です");
      this.expect(":");
      const body = [];
      while (!this.isId("case") && !this.isId("default") && !this.is("}")) {
        if (this.cur.t === "eof") this.err("switch が閉じていません");
        body.push(this.parseStmt());
      }
      cases.push({ pats, guard, body });
    }
    this.expect("}");
    return { k: "switch", e, cases };
  }

  // ---- 式
  parseExpr() {
    const left = this.parseTernary();
    const t = this.cur;
    if (t.t === "op" && ASSIGN.has(t.v)) {
      this.p++;
      const right = this.parseExpr();
      if (!["id", "field", "index"].includes(left.k)) this.err("代入できない式です");
      return { k: "assign", op: t.v, target: left, value: right, line: t.line };
    }
    return left;
  }
  parseTernary() {
    const c = this.parseBin(3);
    if (this.is("?")) {
      this.p++;
      const a = this.parseExpr();
      this.expect(":");
      const b = this.parseExpr();
      return { k: "cond", c, a, b };
    }
    return c;
  }
  parseBin(min) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.cur;
      if (t.t !== "op") break;
      const prec = BIN[t.v];
      if (!prec || prec < min) break;
      this.p++;
      const right = this.parseBin(prec + 1);
      left = t.v === "&&" || t.v === "||" || t.v === "??" ? { k: "logic", op: t.v, a: left, b: right } : t.v === "..." ? { k: "range", a: left, b: right } : { k: "bin", op: t.v, a: left, b: right, line: t.line };
    }
    return left;
  }
  parseUnary() {
    const t = this.cur;
    if (t.t === "op") {
      if (t.v === "!" || t.v === "-" || t.v === "~" || t.v === "+") {
        this.p++;
        const e = this.parseUnary();
        if (t.v === "-" && e.k === "num") return { k: "num", v: -e.v };
        return { k: "un", op: t.v, e };
      }
      if (t.v === "++" || t.v === "--") {
        this.p++;
        return { k: "incdec", op: t.v, prefix: true, target: this.parseUnary(), line: t.line };
      }
    }
    if (t.t === "id" && t.v === "new") {
      this.p++;
      let name = this.ident();
      while (this.eat(".")) name = this.ident();
      if (this.is("<")) this.skipType2();
      this.expect("(");
      const args = this.parseArgs();
      return this.parsePostfix({ k: "new", name, args, line: t.line });
    }
    return this.parsePostfix(this.parsePrimary());
  }
  parseArgs() {
    const args = [];
    while (!this.is(")")) {
      args.push(this.parseExpr());
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return args;
  }
  parsePostfix(e) {
    for (;;) {
      const t = this.cur;
      if (t.t !== "op") break;
      if (t.v === ".") {
        this.p++;
        e = { k: "field", o: e, n: this.ident(), line: t.line };
      } else if (t.v === "?.") {
        this.p++;
        e = { k: "field", o: e, n: this.ident(), opt: true, line: t.line };
      } else if (t.v === "(") {
        this.p++;
        e = { k: "call", f: e, args: this.parseArgs(), line: t.line };
      } else if (t.v === "[") {
        this.p++;
        const i = this.parseExpr();
        this.expect("]");
        e = { k: "index", o: e, i, line: t.line };
      } else if (t.v === "++" || t.v === "--") {
        this.p++;
        e = { k: "incdec", op: t.v, prefix: false, target: e, line: t.line };
      } else break;
    }
    return e;
  }
  /** "(" から対応する ")" の次が "->" なら、アロー関数 */
  isArrowAhead() {
    let depth = 0,
      i = this.p;
    for (; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.t === "op" && t.v === "(") depth++;
      else if (t.t === "op" && t.v === ")") {
        depth--;
        if (depth === 0) break;
      } else if (t.t === "eof") return false;
    }
    const nx = this.toks[i + 1];
    return !!nx && nx.t === "op" && nx.v === "->";
  }
  parsePrimary() {
    const t = this.cur;
    const line = t.line;
    if (t.t === "num") {
      this.p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "str") {
      this.p++;
      if (t.v !== null) return { k: "str", v: t.v };
      const parts = t.parts.map((p) => {
        if (typeof p === "string") return p;
        const sub = new Parser(p.src, p.line);
        const e = sub.parseExpr();
        return e;
      });
      return { k: "interp", parts };
    }
    if (t.t === "op") {
      if (t.v === "(") {
        if (this.isArrowAhead()) {
          const params = this.parseParams();
          this.expect("->");
          return { k: "func", params, body: { k: "return", e: this.parseExpr() }, line };
        }
        this.p++;
        const e = this.parseExpr();
        if (this.eat(":")) this.skipType(); // (x : Type) 型チェック式
        this.expect(")");
        return { k: "paren", e };
      }
      if (t.v === "[") return this.parseArrayLit();
      if (t.v === "{") return this.parseObjectLit();
    }
    if (t.t === "id") {
      switch (t.v) {
        case "true":
          this.p++;
          return { k: "lit", v: true };
        case "false":
          this.p++;
          return { k: "lit", v: false };
        case "null":
          this.p++;
          return { k: "lit", v: null };
        case "this":
          this.p++;
          return { k: "this" };
        case "function": {
          this.p++;
          if (this.cur.t === "id") this.p++; // 名前付き関数式
          const params = this.parseParams();
          if (this.eat(":")) this.skipType();
          return { k: "func", params, body: this.parseBlock(), line };
        }
        case "cast": {
          this.p++;
          this.expect("(");
          const e = this.parseExpr();
          if (this.eat(",")) this.skipType();
          this.expect(")");
          return e;
        }
        case "untyped":
          this.p++;
          return this.parseUnary();
        case "if": {
          this.p++;
          this.expect("(");
          const c = this.parseExpr();
          this.expect(")");
          const a = this.parseExpr();
          let b = null;
          if (this.eatId("else")) b = this.parseExpr();
          return { k: "cond", c, a, b };
        }
        case "switch":
          return this.parseSwitch();
      }
      this.p++;
      // x -> expr（引数 1 個のアロー）
      if (this.is("->")) {
        this.p++;
        return { k: "func", params: [{ name: t.v, def: null }], body: { k: "return", e: this.parseExpr() }, line };
      }
      return { k: "id", n: t.v, line };
    }
    this.err("式が必要です");
  }
  parseArrayLit() {
    this.p++; // [
    if (this.isId("for") || this.isId("while")) {
      // 配列内包 [for (x in it) expr]
      this.p++;
      this.expect("(");
      let kn = null,
        vn = this.ident();
      if (this.eat("=>")) {
        kn = vn;
        vn = this.ident();
      }
      if (!this.eatId("in")) this.err("for の in が必要です");
      const it = this.parseExpr();
      this.expect(")");
      const e = this.parseExpr();
      this.expect("]");
      return { k: "comp", kn, vn, it, e };
    }
    const items = [];
    let isMap = false;
    while (!this.is("]")) {
      const a = this.parseExpr();
      if (this.eat("=>")) {
        isMap = true;
        items.push([a, this.parseExpr()]);
      } else items.push(a);
      if (!this.eat(",")) break;
    }
    this.expect("]");
    return isMap ? { k: "map", items } : { k: "array", items };
  }
  parseObjectLit() {
    this.p++; // {
    const props = [];
    while (!this.is("}")) {
      const t = this.cur;
      let key;
      if (t.t === "id") key = t.v;
      else if (t.t === "str" && t.v !== null) key = t.v;
      else this.err("オブジェクトのキーが必要です");
      this.p++;
      this.expect(":");
      props.push([key, this.parseExpr()]);
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { k: "object", props };
  }
}

// ---------------------------------------------------------------- 実行
class Scope {
  constructor(parent) {
    this.v = new Map();
    this.parent = parent;
  }
  find(n) {
    for (let s = this; s; s = s.parent) if (s.v.has(n)) return s;
    return null;
  }
}

/** 未対応 API の代役。何をされても落ちず、使われたことだけ記録する */
export const isStub = (o) => typeof o === "function" && o.__stub !== undefined;
export function makeStub(path, onUse) {
  const cache = new Map();
  const target = function () {};
  const px = new Proxy(target, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return undefined;
      if (prop === "toString" || prop === "valueOf") return () => path;
      if (prop === "length") return 0;
      if (prop === "__stub") return path;
      if (!cache.has(prop)) cache.set(prop, makeStub(`${path}.${prop}`, onUse));
      return cache.get(prop);
    },
    set() {
      onUse(path, true);
      return true;
    },
    apply() {
      onUse(path);
      return makeStub(`${path}()`, onUse);
    },
    construct() {
      onUse(path);
      return makeStub(`new ${path}`, onUse);
    },
  });
  return px;
}

const ARR_SHIM = {
  copy: (a) => a.slice(),
  remove: (a, x) => {
    const i = a.indexOf(x);
    if (i < 0) return false;
    a.splice(i, 1);
    return true;
  },
  insert: (a, i, x) => void a.splice(i, 0, x),
  contains: (a, x) => a.includes(x),
  iterator: (a) => a,
  resize: (a, n) => void (a.length = n),
};

export class HScript {
  /**
   * @param host { globals: {name: value}, bases: {名前: {init(inst,args), methods:{}}}, warn(msg), onStub(path, isSet) }
   */
  constructor(host) {
    this.host = host;
    this.classes = new Map(); // 名前 → クラス定義（読み込んだファイル全部）
    this.stubs = new Map();
    this.steps = 0;
    this.depth = 0;
  }
  load(source, fileName = "") {
    const defs = new Parser(source).parseModule();
    for (const c of defs) {
      c.file = fileName;
      c.staticVals = new Map();
      this.classes.set(c.name, c);
    }
    // static var の初期化
    for (const c of defs)
      for (const f of c.fields)
        if (f.isStatic) c.staticVals.set(f.name, f.init ? this.ev(f.init, new Scope(null), { cls: c, self: null }) : null);
    return defs;
  }
  /** ベースクラスをたどって、指定名を継承しているか */
  extendsOf(cls, name) {
    for (let c = cls; c; c = this.classes.get(c.ext)) {
      if (c.name === name || c.ext === name) return true;
      if (!this.classes.has(c.ext)) return false;
    }
    return false;
  }
  rootBase(cls) {
    let c = cls;
    while (c && this.classes.has(c.ext)) c = this.classes.get(c.ext);
    return c ? c.ext : null;
  }
  instantiate(cls, args = []) {
    const inst = { __cls: cls };
    this.initFields(cls, inst);
    this.runCtor(cls, inst, args);
    return inst;
  }
  initFields(cls, inst) {
    const parent = this.classes.get(cls.ext);
    if (parent) this.initFields(parent, inst);
    for (const f of cls.fields) if (!f.isStatic) inst[f.name] = f.init ? this.ev(f.init, new Scope(null), { cls, self: inst }) : null;
  }
  runCtor(cls, inst, args) {
    const parent = this.classes.get(cls.ext);
    if (cls.ctor) {
      this.invoke(cls, cls.ctor, inst, args);
      return;
    }
    // コンストラクタなし: 親にそのまま渡す
    if (parent) this.runCtor(parent, inst, args);
    else this.baseInit(cls, inst, args);
  }
  baseInit(cls, inst, args) {
    const b = this.host.bases?.[cls.ext];
    if (b?.init) b.init(inst, args);
  }
  findMethod(cls, name) {
    for (let c = cls; c; c = this.classes.get(c.ext)) {
      const m = c.methods.get(name);
      if (m) return { m, cls: c };
    }
    return null;
  }
  /** ホストから呼ぶ: インスタンスのメソッドを呼ぶ（無ければ基底クラスの既定動作） */
  call(inst, name, args = []) {
    this.steps = 0;
    const f = this.findMethod(inst.__cls, name);
    if (f) return this.invoke(f.cls, f.m, inst, args);
    return this.baseMethod(inst.__cls, inst, name, args);
  }
  has(inst, name) {
    return !!this.findMethod(inst.__cls, name);
  }
  baseMethod(cls, inst, name, args) {
    const b = this.host.bases?.[this.rootBase(cls)];
    const fn = b?.methods?.[name];
    return fn ? fn.apply(inst, args) : null;
  }
  invoke(cls, m, self, args) {
    if (++this.depth > 200) {
      this.depth = 0;
      throw new HScriptError("呼び出しが深すぎます（無限再帰?）");
    }
    try {
      const sc = new Scope(null);
      const fr = { cls, self };
      m.params.forEach((p, i) => {
        let v = args[i];
        if (v === undefined) v = p.def ? this.ev(p.def, sc, fr) : null;
        sc.v.set(p.name, v);
      });
      const r = this.execBody(m.body, sc, fr);
      return r && r.sig === "ret" ? r.v : null;
    } finally {
      this.depth--;
    }
  }
  execBody(body, sc, fr) {
    return body.k === "return" ? new Ret(this.ev(body.e, sc, fr)) : this.exec(body, sc, fr);
  }
  makeFn(node, sc, fr) {
    const self = this;
    return function (...args) {
      const s = new Scope(sc);
      node.params.forEach((p, i) => {
        let v = args[i];
        if (v === undefined) v = p.def ? self.ev(p.def, s, fr) : null;
        s.v.set(p.name, v);
      });
      const r = self.execBody(node.body, s, fr);
      return r && r.sig === "ret" ? r.v : null;
    };
  }
  tick(line) {
    if (++this.steps > 4e6) {
      this.steps = 0;
      throw new HScriptError(`処理が終わりません（${line ?? "?"} 行目付近。無限ループ?）`);
    }
  }

  // ---- 文
  exec(n, sc, fr) {
    switch (n.k) {
      case "block": {
        const s = new Scope(sc);
        for (const st of n.body) {
          const r = this.exec(st, s, fr);
          if (r) return r;
        }
        return;
      }
      case "expr":
        this.ev(n.e, sc, fr);
        return;
      case "var":
        for (const d of n.decls) sc.v.set(d.name, d.init ? this.ev(d.init, sc, fr) : null);
        return;
      case "if":
        if (this.ev(n.c, sc, fr)) return this.exec(n.a, sc, fr);
        else if (n.b) return this.exec(n.b, sc, fr);
        return;
      case "while":
        while (this.ev(n.c, sc, fr)) {
          this.tick(n.line);
          const r = this.exec(n.body, sc, fr);
          if (r) {
            if (r === BRK) break;
            if (r === CONT) continue;
            return r;
          }
        }
        return;
      case "dowhile":
        do {
          this.tick(n.line);
          const r = this.exec(n.body, sc, fr);
          if (r) {
            if (r === BRK) break;
            if (r === CONT) continue;
            return r;
          }
        } while (this.ev(n.c, sc, fr));
        return;
      case "for": {
        const it = this.ev(n.it, sc, fr);
        for (const [k, v] of this.iterate(it, !!n.kn)) {
          this.tick(n.line);
          const s = new Scope(sc);
          if (n.kn) s.v.set(n.kn, k);
          s.v.set(n.vn, v);
          const r = this.exec(n.body, s, fr);
          if (r) {
            if (r === BRK) break;
            if (r === CONT) continue;
            return r;
          }
        }
        return;
      }
      case "return":
        return new Ret(n.e ? this.ev(n.e, sc, fr) : null);
      case "break":
        return BRK;
      case "continue":
        return CONT;
      case "throw":
        throw new ThrowSignal(this.ev(n.e, sc, fr));
      case "try":
        try {
          return this.exec(n.body, sc, fr);
        } catch (e) {
          if (!n.catches.length) throw e;
          const val = e instanceof ThrowSignal ? e.value : e instanceof Error ? e.message : e;
          const s = new Scope(sc);
          s.v.set(n.catches[0].name, val);
          return this.exec(n.catches[0].body, s, fr);
        }
    }
    throw new HScriptError("内部エラー: 不明な文 " + n.k);
  }
  *iterate(it, withKey) {
    if (it == null) throw new HScriptError("null を for で繰り返そうとしました");
    if (it.__range) {
      for (let i = it.a; i < it.b; i++) yield [i, i];
      return;
    }
    if (Array.isArray(it)) {
      for (let i = 0; i < it.length; i++) yield [i, it[i]];
      return;
    }
    if (it instanceof HMap) {
      if (withKey) for (const [k, v] of it.m) yield [k, v];
      else for (const v of it.m.values()) yield [v, v];
      return;
    }
    if (typeof it.iterator === "function") {
      const r = it.iterator();
      if (Array.isArray(r)) {
        for (let i = 0; i < r.length; i++) yield [i, r[i]];
        return;
      }
      if (r && typeof r.hasNext === "function") {
        while (r.hasNext()) {
          const v = r.next();
          yield [v, v];
        }
        return;
      }
    }
    if (typeof it[Symbol.iterator] === "function") {
      let i = 0;
      for (const v of it) yield [i++, v];
      return;
    }
    throw new HScriptError("繰り返せない値です");
  }

  // ---- 式
  lookup(name, sc, fr) {
    const s = sc.find(name);
    if (s) return { found: true, v: s.v.get(name), scope: s };
    if (fr.self && name in fr.self) return { found: true, v: fr.self[name], inst: true };
    if (fr.self) {
      const f = this.findMethod(fr.self.__cls, name);
      if (f) return { found: true, v: (...a) => this.invoke(f.cls, f.m, fr.self, a) };
    }
    for (let c = fr.cls; c; c = this.classes.get(c.ext)) {
      if (c.staticVals?.has(name)) return { found: true, v: c.staticVals.get(name), cls: c };
      const sm = c.statics.get(name);
      if (sm) return { found: true, v: (...a) => this.invoke(c, sm, null, a) };
    }
    const g = this.host.globals;
    if (name in g) return { found: true, v: g[name], global: true };
    const sib = this.classes.get(name);
    if (sib) return { found: true, v: { __classRef: sib }, global: true };
    return { found: false };
  }
  stub(name) {
    if (!this.stubs.has(name)) this.stubs.set(name, makeStub(name, (p, isSet) => this.host.onStub?.(p, isSet)));
    return this.stubs.get(name);
  }
  getField(o, name, line, opt) {
    if (isStub(o)) return o[name];
    if (o == null) {
      if (opt) return null;
      throw new HScriptError(`null の「${name}」にアクセスしました（${line ?? "?"} 行目）。実ゲームでもエラーになります。`);
    }
    if (o.__classRef) {
      const c = o.__classRef;
      if (c.staticVals.has(name)) return c.staticVals.get(name);
      const sm = c.statics.get(name);
      if (sm) return (...a) => this.invoke(c, sm, null, a);
      throw new HScriptError(`${c.name}.${name} は定義されていません`);
    }
    if (o.__cls) {
      if (name in o) return o[name];
      const f = this.findMethod(o.__cls, name);
      if (f) return (...a) => this.invoke(f.cls, f.m, o, a);
      const b = this.host.bases?.[this.rootBase(o.__cls)]?.methods?.[name];
      if (b) return b.bind(o);
      return this.hostField(o, name);
    }
    return this.hostField(o, name);
  }
  hostField(o, name) {
    const v = o[name];
    if (typeof v === "function" && !(v.__stub !== undefined)) return v.bind(o);
    return v === undefined ? null : v;
  }
  callMethod(o, name, args, line, opt) {
    if (o == null) {
      if (opt) return null;
      throw new HScriptError(`null の「${name}()」を呼びました（${line ?? "?"} 行目）。実ゲームでもエラーになります。`);
    }
    if (isStub(o)) return o[name](...args);
    if (Array.isArray(o) && ARR_SHIM[name]) return ARR_SHIM[name](o, ...args);
    if (o.__cls) {
      const f = this.findMethod(o.__cls, name);
      if (f) return this.invoke(f.cls, f.m, o, args);
      const b = this.host.bases?.[this.rootBase(o.__cls)]?.methods?.[name];
      if (b) return b.apply(o, args);
      const fv = o[name];
      if (typeof fv === "function") return fv(...args);
      throw new HScriptError(`${o.__cls.name} に ${name}() がありません（${line ?? "?"} 行目）`);
    }
    if (o.__classRef) {
      const c = o.__classRef;
      const sm = c.statics.get(name);
      if (sm) return this.invoke(c, sm, null, args);
      throw new HScriptError(`${c.name}.${name}() は定義されていません`);
    }
    const fn = o[name];
    if (typeof fn === "function") return fn.apply(o, args);
    if (fn === undefined || fn === null) {
      throw new HScriptError(`「${name}()」という関数がありません（${line ?? "?"} 行目）`);
    }
    throw new HScriptError(`「${name}」は関数ではありません（${line ?? "?"} 行目）`);
  }
  eq(a, b) {
    if (a == null || b == null) return a == b;
    return a === b;
  }
  ev(n, sc, fr) {
    switch (n.k) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "lit":
        return n.v;
      case "paren":
        return this.ev(n.e, sc, fr);
      case "this":
        return fr.self;
      case "interp": {
        let s = "";
        for (const p of n.parts) s += typeof p === "string" ? p : this.str(this.ev(p, sc, fr));
        return s;
      }
      case "id": {
        const r = this.lookup(n.n, sc, fr);
        if (r.found) return r.v;
        if (n.n === "super") return { __super: true };
        return this.stub(n.n);
      }
      case "field": {
        if (n.o.k === "id" && n.o.n === "super") {
          const base = this.classes.get(fr.cls.ext);
          const nm = n.n;
          return (...a) => {
            if (base) {
              const f = this.findMethod(base, nm);
              if (f) return this.invoke(f.cls, f.m, fr.self, a);
            }
            return this.baseMethod(fr.cls, fr.self, nm, a);
          };
        }
        return this.getField(this.ev(n.o, sc, fr), n.n, n.line, n.opt);
      }
      case "index": {
        const o = this.ev(n.o, sc, fr),
          i = this.ev(n.i, sc, fr);
        if (o == null) throw new HScriptError(`null に [] でアクセスしました（${n.line} 行目）`);
        if (o instanceof HMap) return o.get(i);
        const v = o[i];
        return v === undefined ? null : v;
      }
      case "call": {
        const f = n.f;
        if (f.k === "id" && f.n === "super") {
          // super(...) — 親のコンストラクタ
          const parent = this.classes.get(fr.cls.ext);
          const args = n.args.map((a) => this.ev(a, sc, fr));
          if (parent) this.runCtor(parent, fr.self, args);
          else this.baseInit(fr.cls, fr.self, args);
          return null;
        }
        if (f.k === "field") {
          if (f.o.k === "id" && f.o.n === "super") {
            const args = n.args.map((a) => this.ev(a, sc, fr));
            return this.ev(f, sc, fr)(...args);
          }
          const o = this.ev(f.o, sc, fr);
          const args = n.args.map((a) => this.ev(a, sc, fr));
          return this.callMethod(o, f.n, args, n.line, f.opt);
        }
        const fn = this.ev(f, sc, fr);
        const args = n.args.map((a) => this.ev(a, sc, fr));
        if (typeof fn !== "function") {
          if (fn == null) throw new HScriptError(`null を関数として呼びました（${n.line} 行目）`);
          throw new HScriptError(`関数ではない値を呼びました（${n.line} 行目）`);
        }
        return fn(...args);
      }
      case "new": {
        const args = n.args.map((a) => this.ev(a, sc, fr));
        const cls = this.classes.get(n.name);
        if (cls) return this.instantiate(cls, args);
        const g = this.host.globals[n.name];
        if (typeof g === "function") return new g(...args);
        if (g && g.__new) return g.__new(...args);
        this.host.onStub?.("new " + n.name);
        return this.stub("new " + n.name);
      }
      case "un": {
        const v = this.ev(n.e, sc, fr);
        switch (n.op) {
          case "!":
            return !v;
          case "-":
            return -v;
          case "+":
            return +v;
          case "~":
            return ~v;
        }
        break;
      }
      case "logic": {
        const a = this.ev(n.a, sc, fr);
        if (n.op === "&&") return a ? this.ev(n.b, sc, fr) : a;
        if (n.op === "||") return a ? a : this.ev(n.b, sc, fr);
        return a != null ? a : this.ev(n.b, sc, fr);
      }
      case "cond":
        return this.ev(n.c, sc, fr) ? this.ev(n.a, sc, fr) : n.b ? this.ev(n.b, sc, fr) : null;
      case "range":
        return { __range: true, a: this.ev(n.a, sc, fr), b: this.ev(n.b, sc, fr) };
      case "bin":
        return this.binop(n.op, this.ev(n.a, sc, fr), this.ev(n.b, sc, fr), n.line);
      case "array":
        return n.items.map((x) => this.ev(x, sc, fr));
      case "map": {
        const m = new HMap();
        for (const [k, v] of n.items) m.set(this.ev(k, sc, fr), this.ev(v, sc, fr));
        return m;
      }
      case "object": {
        const o = {};
        for (const [k, v] of n.props) o[k] = this.ev(v, sc, fr);
        return o;
      }
      case "comp": {
        const out = [];
        for (const [k, v] of this.iterate(this.ev(n.it, sc, fr), !!n.kn)) {
          const s = new Scope(sc);
          if (n.kn) s.v.set(n.kn, k);
          s.v.set(n.vn, v);
          out.push(this.ev(n.e, s, fr));
        }
        return out;
      }
      case "func":
        return this.makeFn(n, sc, fr);
      case "switch": {
        const v = this.ev(n.e, sc, fr);
        for (const c of n.cases) {
          let hit = c.pats === null;
          if (!hit)
            for (const p of c.pats) {
              if (p.k === "id" && p.n === "_") {
                hit = true;
                break;
              }
              if (this.eq(v, this.ev(p, sc, fr))) {
                hit = true;
                break;
              }
            }
          if (hit && c.guard && !this.ev(c.guard, sc, fr)) hit = false;
          if (!hit) continue;
          const s = new Scope(sc);
          let last = null;
          for (const st of c.body) {
            if (st.k === "expr") last = this.ev(st.e, s, fr);
            else {
              const r = this.exec(st, s, fr);
              if (r) {
                this.pendingSig = r; // return / break を switch の外へ伝える
                return null;
              }
            }
          }
          return last;
        }
        return null;
      }
      case "assign":
        return this.assign(n, sc, fr);
      case "incdec": {
        const cur = this.ev(n.target, sc, fr);
        const next = n.op === "++" ? cur + 1 : cur - 1;
        this.store(n.target, next, sc, fr);
        return n.prefix ? next : cur;
      }
    }
    throw new HScriptError("内部エラー: 不明な式 " + n.k);
  }
  str(v) {
    if (v == null) return "null";
    if (typeof v === "number") return String(v);
    if (typeof v === "object" && v.__cls) return v.__cls.name;
    if (typeof v === "object" && !Array.isArray(v) && !(v instanceof HMap)) {
      try {
        return JSON.stringify(v);
      } catch {}
    }
    return String(v);
  }
  binop(op, a, b, line) {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return a / b;
      case "%":
        return a % b;
      case "==":
        return this.eq(a, b);
      case "!=":
        return !this.eq(a, b);
      case "<":
        return a < b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      case ">=":
        return a >= b;
      case "&":
        return a & b;
      case "|":
        return a | b;
      case "^":
        return a ^ b;
      case "<<":
        return a << b;
      case ">>":
        return a >> b;
      case ">>>":
        return a >>> b;
    }
    throw new HScriptError(`未対応の演算子 ${op}（${line} 行目）`);
  }
  assign(n, sc, fr) {
    let v;
    if (n.op === "=") v = this.ev(n.value, sc, fr);
    else if (n.op === "??=") {
      const cur = this.ev(n.target, sc, fr);
      if (cur != null) return cur;
      v = this.ev(n.value, sc, fr);
    } else v = this.binop(n.op.slice(0, -1), this.ev(n.target, sc, fr), this.ev(n.value, sc, fr), n.line);
    this.store(n.target, v, sc, fr);
    return v;
  }
  store(t, v, sc, fr) {
    if (t.k === "id") {
      const r = this.lookup(t.n, sc, fr);
      if (r.found) {
        if (r.scope) r.scope.v.set(t.n, v);
        else if (r.inst) fr.self[t.n] = v;
        else if (r.cls) r.cls.staticVals.set(t.n, v);
        else this.host.globals[t.n] = v;
      } else if (fr.self) fr.self[t.n] = v;
      else sc.v.set(t.n, v);
      return;
    }
    if (t.k === "field") {
      const o = this.ev(t.o, sc, fr);
      if (o == null) throw new HScriptError(`null の「${t.n}」に代入しました（${t.line} 行目）`);
      if (isStub(o)) o[t.n] = v;
      else if (o.__classRef) o.__classRef.staticVals.set(t.n, v);
      else o[t.n] = v;
      return;
    }
    if (t.k === "index") {
      const o = this.ev(t.o, sc, fr),
        i = this.ev(t.i, sc, fr);
      if (o == null) throw new HScriptError(`null に [] で代入しました（${t.line} 行目）`);
      if (o instanceof HMap) o.set(i, v);
      else o[i] = v;
    }
  }
}
