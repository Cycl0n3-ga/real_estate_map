# 良富居地產 - Agent 專案指南

## 專案核心架構與技術棧 (No Build Tools)

本專案經過架構升級，為解決早期 Leaflet 渲染大量 DOM 造成的效能瓶頸，並維持「無建置工具」的輕量化部署，目前採用以下技術棧：

1.  **前端框架：Vue 3 (Composition API)**
    *   **引入方式**：經由 CDN 全局引入 (`vue.global.js`)。
    *   **設計模式**：使用 `<script type="module">` 將邏輯拆分為 `api.js` (資料獲取), `map.js` (地圖引擎), `app.js` (Vue 狀態管理與根組件)。
    *   **UI 渲染**：依賴 Vue 的資料綁定 (Data Binding) 來渲染 DOM，不再使用 `innerHTML`。

2.  **地圖引擎：MapLibre GL JS**
    *   **引入方式**：經由 CDN 引入。
    *   **資料格式**：地圖資料必須轉換為 `GeoJSON` 格式再餵給 MapLibre Source。
    *   **效能優化**：依賴 MapLibre 內建的 WebGL 硬體加速與 `cluster` 設定。複雜的地圖標記樣式（如雙圈、雙變數）皆使用 MapLibre 的資料驅動樣式表達式 (Expressions) 在 GPU 端計算。

3.  **樣式排版：Vanilla CSS**
    *   **技術選擇**：維持純自訂 CSS (`styles.css`)。**不使用 Tailwind CSS 等 Utility 框架**。
    *   **RWD & 兼容性**：針對 iOS Safari 使用了 `viewport-fit=cover` 與 `env(safe-area-inset-bottom)`。

## 開發與修改注意事項

*   **無建置流程**：不可引入 npm 套件或要求編譯器 (如 Vite/Webpack)。所有的外部套件必須是可用的 CDN URL。
*   **Vue 的坑**：因未使用單檔組件 (`.vue`)，在建立 Vue 組件 (如 `app.component('tx-card', ...`) 時，模板必須使用 Template Literal (`` `...` ``) 且無法享有 Vue SFC 的語法高亮。傳遞方法或全局設定時請善用 `provide/inject`。
*   **地圖互動同步**：列表 (Sidebar) 與地圖 (MapLibre) 的雙向互動：
    *   點擊列表：使用 `map.flyTo` 將地圖平移。
    *   懸停列表：發送 feature state 或 filter 變更至 `unclustered-point-outer` 圖層修改透明度 (Highlight)。
    *   懸停標記：MapLibre 透過事件回傳資料至 Vue 的 `activeCardIdx`，並使用 `scrollIntoView()` 將列表滾動至指定卡片。
    *   為防止無限循環，程式化平移 (flyTo) 時必須設置 `setHoverPanSuppressed(true)`。
*   **MapLibre 除錯**：在撰寫 `clusterProperties` 的平均計算表達式時，請特別注意預防「除以零 (Division by Zero)」的情況（使用 `case` 表達式捕捉分母為 0），否則會導致 WebGL Context 崩潰。

## 測試環境
*   可使用 Python 內建 HTTP Server 進行測試：`python3 -m http.server 8080`
*   確保自動測試產生之任何截圖或腳本在提交前皆已清除。
