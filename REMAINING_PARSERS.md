# 剩餘語言 Parser 待辦清單

把 `common_parser.py` 的長尾語言逐一升級成 `src/parsers/<lang>_parser.py` 專屬
parser 的工作。**前 6 個已完成**（R、Protobuf、GraphQL、Zig、D、SQL），本檔記錄
**尚未完成的 13 個**與接手所需的全部資訊。

> 背景與完整規格見計畫檔 `C:\Users\Morris\.claude\plans\hi-lucky-wilkes.md`。

---

## 進度

| 狀態 | 語言 |
|------|------|
| ✅ 已完成 | R, Protobuf, GraphQL, Zig, D, SQL |
| ⬜ 待辦 | CSS 家族, Ruby, Crystal, Julia, Elixir, VB.NET, Clojure, Erlang, F#, OCaml, Nim, Haskell, Elm |

待辦共 **13 個 parser 檔**（CSS 家族 5 個副檔名合併成 1 個檔，比照 `objc_parser` 同時處理 `.m`/`.mm`）。

---

## 不需要改動的部分（重要）

- **`FILE_TYPE_MAP`**（`src/core/analyze_viz.py` ~226）：13 種副檔名**全都已存在**，不用改。
- **前端 `static/core/viz_constants.js`**：`FILE_TYPE_SHAPE` / `FILE_TYPE_FULL_NAME` /
  顏色 / 圖例**都已存在**（`ruby_source`、`css_source`、`elixir_source` …），不用改。
- **`src/core/detector.py`**：屬於專案型別偵測，與逐檔 parsing 無關，不在範圍內。

也就是說每個語言只要：**(1) 新增 parser 檔 → (2) 在 analyze_viz.py 接線 3 處 → (3) 驗證**。

---

## 共用實作規格

每個 parser 必須：**零外部相依**（只用 `re`），回傳標準 6-tuple：

```
(imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs)
```

- `imports`：leaf-name 字串 list（`resolve_ref` 以 stem 比對）。
- `funcdefs`：`[{'label', 'is_efiapi': False, 'is_static': bool}]`。
- `funccalls`：呼叫名稱 list，**需排除宣告名**（用 scala/objc 的 `decl_name_starts` skip-set）。
- `extra`：`{'imports', 'lang', 'package'?, 'docstrings'?}`。
- `func_calls_by_func`：與 `funcdefs` 等長，逐函式 body-scoped 呼叫 list。
- `symbol_defs`：`[{'kind','name','line','end_line','bases','parent','is_public','doc','complexity'}]`。

並且要：以字元層級遮罩註解與字面值（**保留 offset/換行**，讓 `line`/`end_line` 正確）、
提供 `_line_no`、`_count_complexity(body)`，以及 `<LANG>_EXTENSIONS` 集合與
`scan_<lang>(src, ext=...)` 進入點。

### 可直接抄的骨架

| body 形式 | 參考的現成 parser |
|-----------|-------------------|
| 大括號 `{}` | `src/parsers/scala_parser.py`、剛寫的 `zig_parser.py` / `d_parser.py` |
| `end` 關鍵字（深度掃描） | `src/parsers/lua_parser.py` |
| range + parent 歸屬 | `src/parsers/objc_parser.py` |
| 特殊終止符 / 偏移掃描 | 剛寫的 `sql_parser.py`（dollar-quote 略過）、`graphql_parser.py` |

---

## 前 6 個學到的教訓（務必沿用）

1. **字串洩漏防護**：若 import 需從「保留字串」的版本擷取（為了拿引號內的路徑/套件名），
   一定要用「遮罩版 `clean`」檢查關鍵字位置是否被遮掉，避免字串／多行字串裡的
   `import(...)` 被誤判。範例（R、Zig）：
   ```python
   def _real_kw(pos):  # 關鍵字字元只有在真實程式碼才會在 clean 中保留
       return pos < len(clean) and not clean[pos].isspace()
   ```
2. **引號內的宣告目標**（如 `setClass("Vehicle")`、`import "x"`）：要掃「保留字串」版本，
   並同樣用上面的 guard 排除字串內假目標。
3. **慣例 token 要精確**：GraphQL 的 Apollo `#import`（**`#` 後不可有空白**）才算 import，
   `# import`（有空白）是一般註解。
4. **先切路徑分隔符再去副檔名**：proto stem bug —— 應 `split('/','\\')` 取 basename 後再
   去掉 `.proto`，不要先 `split('.')`。
5. **結構掃描前先遮罩字面值**：讓字串／註解裡長得像 def/import 的文字不會洩漏成節點。
6. **module docstring 別放裸 `"""`**：docstring 內出現字面三引號會提早關閉 docstring（GraphQL
   踩過）。描述三引號改用文字說明或單引號表示。

每個 parser 至少要有：1 個 happy-path、1 個 adversarial（註解／字串內含 def/import 字樣、
同名符號）、1 個 regression（其他語言因以副檔名分派，結構上不受影響）。

---

## 接線方式 —— `src/core/analyze_viz.py`（每個語言改 3 處）

以 Ruby 為例：

1. **import 區塊**（`try` ~56-75）新增：
   ```python
   from parsers.ruby_parser import scan_ruby, RUBY_EXTENSIONS as _RUBY_EXTENSIONS
   ```
   並在 `except ImportError` fallback（~80-95）加 `_RUBY_EXTENSIONS = set()`。
2. **`_get_parser_fn(ext)`**（~119-167）：在 `return scan_common` 之前加
   `if ext in _RUBY_EXTENSIONS: return scan_ruby`。
3. **scan 分派鏈**（~702-749）：在 `elif _PARSERS_LOADED: raw = scan_common(...)` 之前加
   `elif ext in _RUBY_EXTENSIONS and _PARSERS_LOADED: raw = scan_ruby(src, ext)`。

CSS 家族：`CSS_EXTENSIONS = {'.css','.scss','.sass','.less','.styl'}`、`scan_css(src, ext)`，
`extra['lang']` 依副檔名給 `css`/`scss`/`sass`/`less`/`stylus`（比照 objc/objcpp）。

---

## 待辦各語言抽取規則（已對照官方語法）

| 語言 | 副檔名 | import 語法 | 定義關鍵字 | body 形式 | 註解 / 字面值陷阱 |
|------|--------|-------------|-----------|-----------|-------------------|
| CSS 家族 | .css .scss .sass .less .styl | `@import`/`@use`/`@forward`/`@require "x"` | SCSS `@mixin`/`@function`/`@keyframes`、LESS `.mixin()`、Stylus `name()` | `{}`（`.sass` 縮排 → degrade） | `/* */`，scss/less/styl 另有 `//` |
| Ruby | .rb | `require`/`require_relative` | `def`、`def self.`、`class`、`module` | `end` 深度 | `#`、`=begin/=end`；heredoc `<<~`、`%w[]` |
| Crystal | .cr | `require "..."` | `def`、`def self.`、`class/module/struct`、`macro` | `end` 深度 | `#`；`"..."`、`'c'` |
| Julia | .jl | `using`/`import`/`include` | `function`、短式 `f(x)=`、`struct`/`mutable struct`/`abstract type`、`macro`、`module` | `end` 深度 | `#`、巢狀 `#= =#`；`"""` |
| Elixir | .ex .exs | `alias`/`import`/`use`/`require` | `def`/`defp`/`defmacro`、`defmodule`/`defprotocol` | `do`..`end`（跳過行內 `do:`） | `#`；`"""` heredoc、`~s()` sigil |
| VB.NET | .vb | `Imports X` | `Sub`/`Function`/`Class`/`Module`/`Structure`/`Interface`/`Property` | `End Sub/...` | `'`、`REM`；`"` 以 `""` escape；**關鍵字不分大小寫** |
| Clojure | .clj .cljs | `(ns ..(:require ..))`、`(require ..)` | `(defn/defn-/def/defmacro)`、`(defrecord/defprotocol/deftype/definterface)` | **括號深度** | `;` 行註解、`#_` form；`"..."` |
| Erlang | .erl .hrl | `-include`/`-include_lib`/`-import`/`-behaviour` | `-module(...)`、`name(Args) ->` 子句 | 子句以 `.` 結束 | `%`；`"..."`、`'atom'` |
| F# | .fs .fsx | `open M` / `module` / `namespace` | `let [rec]`、`member`、`type` | 縮排 → degrade | `//`、巢狀 `(* *)`；`"""`、`@"..."` verbatim |
| OCaml | .ml .mli | `open`/`include M` | `let [rec]`、`and`、`type`、`module M = struct` | 巢狀 `(* *)` only（**無行註解**）；`{\|..\|}` 字串 |
| Nim | .nim | `import`/`from..import`/`include` | `proc/func/method/template/macro/iterator/converter`、`type` 區段 | 縮排 → degrade | `#`、`#[ ]#`、`##` doc；`r"..."`、`"""`；`*` 匯出標記 |
| Haskell | .hs | `import [qualified] M` | `name ::` 簽章、`name =`、`data/newtype/type/class/instance` | 縮排 → degrade | `--`、巢狀 `{- -}`；`"..."`、`'c'` |
| Elm | .elm | `import M exposing` | `name :` 簽章、`name =`、`type [alias]`、`port` | 縮排 → degrade | `--`、巢狀 `{- -}`；`"""` |

**body 形式分組（決定 end_line 策略）**

- `end` 關鍵字深度掃描：Ruby、Crystal、Julia、Elixir（`do`/`end`）、VB.NET（`End X`）。
- 縮排式 → 退化成宣告行（best-effort）：F#、Nim、Haskell、Elm、Sass。
- 特殊終止符：Clojure（括號深度）、Erlang（`.`/`;` 子句）。

---

## 建議實作順序

由結構單純者先做，鞏固骨架後再處理縮排式：

**CSS 家族 → Ruby → Crystal → Julia → Elixir → VB.NET → Clojure → Erlang → F# → OCaml → Nim → Haskell → Elm**

每個語言流程：(a) 寫 parser →(b) 接線 3 處 →(c) 在 `tmp_verify/check.py` 加一個 case（happy +
adversarial）並重跑 →(d) schema/sanity 通過再做下一個。

---

## 驗證

- **單元 harness**：`python tmp_verify/check.py`。重跑時會把先前語言當回歸測試。
  每個 case 會檢查 6-tuple schema、`end_line >= line`、`lang` 欄位、應有的 imports/defs/syms、
  以及「禁止出現」的假陽性。
- **端對端**：在 `tmp_verify/poly/` 放各語言互相引用的小檔，跑：
  ```bash
  python src/vizcode.py tmp_verify/poly --scan-only
  ```
  確認：掃描完成無錯、跨檔 import edge 正確、edge 數量沒有相對 common_parser 暴增。
  （可用 `tmp_verify/poly/.vizcode/scan_cache.json` 的 `entries[*].payload` 檢查
  `imports` / `symdefs` / `extras.lang`。）

---

## 全部 13 個完成後的收尾

- CLAUDE.md：在「dedicated parsers」清單加一行說明這些語言已有專屬 parser（目前該清單本就不完整，
  屬示意性質；無 contract 變更）。
- 刪除 `tmp_verify/`（harness + 樣本 + 產生的 `.vizcode/`）。
