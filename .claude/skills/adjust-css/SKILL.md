---
name: adjust-css
description: Adjust CSS styles in the VIZCODE frontend. Use this skill whenever the user wants to change colors, spacing, fonts, borders, backgrounds, shadows, border-radius, opacity, or any visual appearance of nodes/panels/UI elements. Trigger on requests like "改顏色", "調間距", "邊框太粗", "背景色", "字體大小", "pill 太高", "section 顏色", "圓角", etc.
---

# SKILL: Adjust CSS — VIZCODE Frontend

## File Map

| 要改什麼 | 改哪個檔案 |
|---------|-----------|
| 全域色系、背景、panel、border | `static/viz.css` (`:root` CSS variables) |
| 主題 (dark/light/solarized) | `static/themes.css` |
| Symbol View SVG 節點外觀 (背景/邊框/特效) | `static/symbol_view/symbol_view.css` |
| Symbol View 版面間距/尺寸常數 | `static/symbol_view/sv_graph.js` (頂部 `_SV_*` 常數) |
| Symbol View 顏色映射定義 | `static/symbol_view/sv_core.js` (`_SV_KIND_COLOR`, `_SV_EDGE_COLOR`) |
| 主視圖 (L0/L1/L2) graph node 顏色形狀 | `static/viz_state.js` 或 `static/viz.js` (`extColor()`, `FILE_TYPE_SHAPE`) |

## CSS Variable 速查 (viz.css :root)

```css
--bg          /* 最底層背景 */
--panel       /* panel / section 背景 */
--panel2      /* card / node 背景 */
--border      /* 所有邊框色 */
--text        /* 主要文字 */
--muted       /* 次要文字 (section header 等) */
--accent      /* 強調色 (selected / active) */
--code-font   /* 程式碼字體 */
```

## Symbol View (V3) SVG 樣式 (symbol_view.css)

目前 Symbol View 已經改為純 SVG 渲染 (不依賴 Cytoscape)，外觀皆寫在 `static/symbol_view/symbol_view.css`：

- **節點基礎**：`.sv-node .sv-node-bg` (fill/stroke)
- **類型邊框色**：`.sv-kind-class .sv-node-bg`, `.sv-kind-method .sv-node-bg` 等
- **方法 (Methods)**：`.sv-node.sv-method-public .sv-node-bg`, `.sv-node.sv-method-private .sv-node-bg`
- **對焦/擴展節點**：`.sv-node.sv-focus-pill`, `.sv-node.sv-focus .sv-node-bg`
- **標籤與文字**：`.sv-node-name`, `.sv-node-kind`, `.sv-access`, `.sv-pill-name`
- **連接線 (Edges)**：`.sv-edge`, `.sv-edge-hit`, `.sv-edge:hover`
- **焦點明細卡片 (HTML in SVG)**：`.sv-fd-card`, `.sv-fd-header`, `.sv-fd-section` 等等

## Symbol View 佈局常數 (sv_graph.js 頂部)

若要調整節點大小、間距、排版距離，請修改 `static/symbol_view/sv_graph.js` 頂部的常數：

```js
const _SV_CLASS_PAD_X   = 16;   // 類別卡片左右內距
const _SV_CLASS_PAD_TOP = 46;   // 類別卡片頂部內距 (標題區)
const _SV_METHOD_H      = 34;   // 方法節點高度
const _SV_PILL_H        = 30;   // 對焦 pill 高度
const _SV_FUNC_H        = 42;   // 頂層函數高度
// ... 其他 _SV_* 開頭的尺寸變數
```

## 工作流程

1. **讀目標檔案** — 依據上方的 File Map 找到對應的 `.css` 或是 `.js` 檔案。
2. **定位並修改** — 尋找對應的 class name 或 `_SV_` 常數。
3. **完成與測試** — 改完後請使用者在瀏覽器按 **Ctrl+Shift+R** 或直接重新整理 (Refresh) 來檢視變更。

## 注意事項

- **沒有 Cytoscape Style**：Symbol View 已經徹底擺脫 Cytoscape，不再有 `_symBuildCyStyle()`，所有樣式請直接改 CSS 或 SVG 屬性。
- **沒有 layout_editor.html**：目前已無此預覽工具，修改後皆需直接重整專案頁面確認。
- 改動 SVG 尺寸時，請確保 `sv_graph.js` 裡的 `_SV_` 常數跟 `symbol_view.css` 裡的字體/邊界設定不會衝突 (例如字體變大但 `_SV_METHOD_H` 沒調大導致文字被切)。
