---
name: adjust-css
description: Adjust CSS styles in the VIZCODE frontend. Use this skill whenever the user wants to change colors, spacing, fonts, borders, backgrounds, shadows, border-radius, opacity, or any visual appearance of nodes/panels/UI elements in viz.css, struct_view.css, themes.css, or inline styles inside symbol_view.js/_symBuildCyStyle(). Trigger on requests like "改顏色", "調間距", "邊框太粗", "背景色", "字體大小", "pill 太高", "section 顏色", "圓角", etc.
---

# SKILL: Adjust CSS — VIZCODE Frontend

## File Map

| 要改什麼 | 改哪個檔案 |
|---------|-----------|
| 全域色系、背景、panel、border | `static/viz.css` (`:root` CSS variables) |
| 主題 (dark/light/solarized) | `static/themes.css` |
| Symbol View / class card 外觀 | `static/symbol_view.js` → `_symBuildCyStyle()` |
| Symbol View 顏色常數 | `static/symbol_view.js` 頂部 `_SYM_*` / `_SYM_EDGE_COLORS` |
| Structure View (struct_view) 外觀 | `static/struct_view.css` |
| L0/L1/L2 graph node 顏色形狀 | `static/viz.js` → `extColor()`, `FILE_TYPE_SHAPE` |
| layout_editor 預覽顏色 | `static/layout_editor.html` → `const COLORS = {...}` |

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

## Symbol View Cytoscape Style (_symBuildCyStyle)

Cytoscape stylesheet 在 `symbol_view.js` 的 `_symBuildCyStyle()` 函數裡，以 JS 陣列形式定義。修改時：

```js
// selector 對應關係
'node[?isClassCard]'   → class card 外框
'node[?isClassHdr]'    → class 名稱 label
'node[?isToggle]'      → 右上角數字徽章
'node[?isSection]'     → PUBLIC/PRIVATE 區塊背景
'node[?isSectionHdr]'  → ⊕ PUBLIC / ⌂ PRIVATE 標題
'node[?isMember][?isPublic]'   → public pill (預設 warm amber #d97706)
'node[?isMember][!isPublic]'   → private pill (預設 blue #60a5fa)
```

## Symbol View 常數 (頂部)

```js
const _SYM_WARM    = '#d97706';   // PUBLIC pill 背景色
const _SYM_WARM_BG = 'rgba(217,119,6,0.18)';
// PRIVATE pill 顏色:
const _SYM_PRIV_BG     = 'rgba(96,165,250,0.12)';
const _SYM_PRIV_BORDER = '#60a5fa';
const _SYM_PRIV_TEXT   = '#60a5fa';
// Edge 顏色:
const _SYM_EDGE_COLORS = { call, inheritance, import, member, override, type_usage, include }
```

## 間距常數 (symbol_view.js 頂部)

修改後用 `layout_editor.html` 立即預覽，確認沒有 label 脫框再貼入主程式。

```js
const _SYM_CHAR_H      = 17;  // card title row height
const _SYM_CARD_PAD    = 13;  // card inner padding (all sides)
const _SYM_CARD_SPC_A  = 12;  // spacing: title → first section
const _SYM_CARD_SPC_Y  =  4;  // spacing: between sections
const _SYM_SEC_TOP     = 33;  // section header area height
const _SYM_SEC_BOT     = 11;  // section bottom padding
const _SYM_SEC_SPC_Y   =  7;  // spacing: between pills
const _SYM_PILL_H      = 22;  // pill height
const _SYM_PILL_RAD    = 14;  // pill corner-radius
const _SYM_TOGGLE_SIZE = 20;  // toggle badge size
```

## 工作流程

1. **讀目標檔案** — 找到要改的 selector 或變數
2. **用 Edit 工具** 做最小改動
3. **間距類改動** → 同步更新 `layout_editor.html` 裡的 `const _C` 預設值
4. **顏色改動** → 同步更新 `layout_editor.html` 裡的 `const COLORS`
5. 告訴使用者 **Ctrl+Shift+R** 重整瀏覽器

## 注意事項

- Cytoscape style 改完後需要重建 cy instance 才生效（在 symbol_view.js 裡 Cytoscape 是在 `_symFetchAndRender` 呼叫 `_symBuildCyStyle()`，每次 render 都重建，所以直接改即可）
- 如果同時改間距常數 + Cytoscape style，確保兩者數值一致（常數供 layout 計算，style 供 Cytoscape 渲染）
- `layout_editor.html` 是獨立 HTML 工具，可直接用 `file://` 開啟確認效果
