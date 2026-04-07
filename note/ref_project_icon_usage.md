# 參考專案 Icon 使用方式筆記

參考專案是透過 **`lucide-react`** 這個套件來處理所有的 Icon，沒有套用針對 Canvas 內部節點繪製 Icon 的功能 (例如沒有用 `@sigma/node-image` 等)。主要的實作慣例如下：

## 1. 集中管理 (Centralized re-exports)
他們建立了一隻代理檔案 `src/lib/lucide-icons.tsx`，把專案所有會用到的 Icon 都從 `lucide-react` import 進來後再統一 export 出去。

```tsx
// src/lib/lucide-icons.tsx
export {
  Search,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  // ... 其他幾十個 icons
} from 'lucide-react';
```
**原因**：這是一個好習慣，可以集中管理專案用到的所有 icon 數量，且未來如果需要最佳化打包 (tree-shaking) 或一次性替換整套 Icon Library，就不用去一百個元件裡面慢慢改 `import` 路徑，只要改這份檔案即可。

## 2. 在 UI 元件中的使用方式
其他所有的 UI 元件 (包含 GraphCanvas 上層懸浮的按鈕等)，都是直接從這個 alias 引入，並當作一般的 React 元件使用，支援傳入 `className` 來調整大小與顏色（通常搭配 TailwindCSS 定義尺寸）：

```tsx
// \src\components\GraphCanvas.tsx
import { ZoomIn, ZoomOut, Maximize2, Play, Pause } from '@/lib/lucide-icons';

// 使用範例
<button onClick={zoomIn} ... >
  <ZoomIn className="w-4 h-4" />
</button>
```

## 3. Sigma 節點沒有放 Icon
如果你想知道的是「**宇宙視圖內的 Node 上面有沒有放 Icon**」：
沒有，參考專案原生的節點只是畫顏色的圓點，搭配 Canvas2D 手工繪製的深色標籤 (黑底白字 pill 樣式，寫在 `useSigma.ts` 的 `defaultDrawNodeHover` 中)，節點內部並沒有嵌入任何影像圖片或 Icon 字型。
