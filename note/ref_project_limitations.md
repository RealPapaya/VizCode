# 參考專案 核心限制與效能邊界深度解析

在研究參考專案的架構時，我們可以從他們的文件與原始碼（如 `swift-ingestion-gaps.md`、`WebGPUFallbackDialog.tsx`、`ingestion.worker.ts` 等）中挖掘出他們所面臨的技術瓶頸。這對於 CodeViz 未來的發展與防坑非常有價值。

## 1. 執行環境與記憶體瓶頸 (Web WASM vs Native)

參考專案提供了純前端 (Web) 以及後端 (CLI/MCP) 雙模式，但純前端模式有著無法避免的物理極限：
*   **檔案上限 (約 5,000 個檔案)**：在瀏覽器中，他們依賴 `LadybugDB WASM` 和 `Tree-sitter WASM` 進行解析與儲存。因為 WASM 的記憶體上限以及瀏覽器的限制，超過 5,000 個檔案很容易導致 Out-Of-Memory (OOM) 崩潰。
*   **資料揮發性 (In-memory)**：Web 版的 LadybugDB 是運作在記憶體中的，只要使用者重新整理網頁（F5），所有辛苦建立的 Graph 與 Embeddings 就會完全消失。要持久化必須依賴 CLI 的 Native LadybugDB。

## 2. WebGPU 與 Embedding (語意搜尋) 的代價

該專案的 Agent 依賴 AI 語意搜尋 (Semantic Search)，這需要用到 Embedding Model (`HuggingFace transformers.js`)：
*   **WebGPU 支援度問題**：如果使用者的瀏覽器不支援 WebGPU（如部分 Safari 或舊版瀏覽器），模型運算會退化到純 CPU 處理（WASM）。
*   **CPU 退化效能極差**：在 `WebGPUFallbackDialog.tsx` 中明確指出，CPU 運算每個節點大約需要 **50ms**。這意味著一個中型的 2,000 節點專案，光是跑 Embedding 就要花 **快 2 分鐘**，如果專案更大則完全不可行。因此他們針對大專案會建議使用者「乾脆跳過 Embedding 步驟」，直接放棄 AI 語意搜尋，只保留 Graph。

## 3. 語言解析深度與 AST (Tree-sitter) 盲區

雖然宣稱支援十多種語言，但依賴 AST (Abstract Syntax Tree) 靜態分析必然會有推論上的死角。從他們的 `swift-ingestion-gaps.md` 中可以看到明確的限制：
*   **型別推論斷鏈**：例如 Swift 中的 `if let` / `guard let` 或迴圈內的自動解包，這種沒有明確標示型別的變數，經常會讓 AST 解析器無法追蹤到其實際呼叫的 Method。
*   **多重繼承/實作缺失**：如果一個 Class 實作了多個 Protocol (例如 `class Foo: Bar, P1, P2`)，他們通常只抓得到第一個，導致後面的相依性關係 (Edges) 在圖譜中遺失。
*   **動態語言與框架魔法**：對於巨集 (Macros) 或依賴 Dependency Injection 的寫法（如 Swift 的 `@EnvironmentObject` 或 Java 的 `@Autowired` 等），單純的 AST 幾乎無法捕捉到真實的連線圖。

## 4. 萬點渲染與物理佈局極限 (Canvas Layout Limits)

在宇宙視圖 (Galaxy View) 的呈現上，他們面對了與 CodeViz 一樣的挑戰，並做出了妥協：
*   **絕對的視覺極簡**：為了撐起 10,000 個節點的 WebGL 渲染，`GraphCanvas.tsx` 中**完全捨棄了所有的 Icon 與複雜 SVG 繪製**，每個節點都被降級成了最基礎的有色圓形 (Color Orbs)。這大幅降低了 GPU 紋理記憶體的負擔。
*   **Web Worker 與超長運算**：力導向圖 (Force-Atlas2) 是算力黑洞。依據他們 `useSigma.ts` 的設定：
    *   超過 10,000 個節點，後台 Worker 會被鎖定計算長達 **45 秒**。
    *   隨著規模變大，他們刻意**降低重力 (Gravity)** 且**增加排斥範圍 (Scaling Ratio)**，否則上萬個節點會全部擠在畫面上的一坨黑球中，完全失去可讀性。

--- 
