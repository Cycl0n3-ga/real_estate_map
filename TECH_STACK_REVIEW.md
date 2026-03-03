# 良富居地產 — 前端技術棧評估與升級指南 (無建置工具版)

本文件旨在分析目前專案使用的技術棧，釐清現有痛點，並提供一套**完全不需要建置工具 (No Build Tools)** 的現代化升級架構與詳細的遷移步驟，以解決效能、可維護性、手機瀏覽器可用性與 UI/UX 的問題。

---

## 一、 現有技術棧分析與痛點

### 1. 目前的技術組合
*   **前端 UI / 邏輯**：純 HTML + 原生 Vanilla JavaScript (`app.js` 單一檔案超過 800 行)。
*   **樣式與排版**：純自訂 CSS (`styles.css`)，依賴 CSS 變數。
*   **地圖引擎**：Leaflet (v1.9.4) + Leaflet.markercluster (v1.5.1)。
*   **後端 API**：串接外部 REST API (`https://volodos.cs.nthu.edu.tw:5001`)。
*   **部署環境**：純靜態檔案，直接部署於 GitHub Pages。
*   **建置工具**：**無** (零配置，直接撰寫與執行)。

### 2. 現有痛點分析
*   **效能 (地圖卡頓)**：這是最嚴重的問題。Leaflet 依賴 DOM 元素 (`<div>`, `<img>`) 來渲染地圖上的標記 (Markers)。當資料量達到約千筆，加上複雜的雙圈/雙變數樣式與群聚 (Clustering) 動畫，DOM 節點數量暴增，導致手機瀏覽器 (尤其是 iOS Safari) 產生嚴重的延遲與卡頓。
*   **可維護性極差**：所有的狀態管理 (如：`txData`, `markerSettings`, `activeCardIdx`) 與 UI 渲染邏輯 (如：無數的 `document.getElementById(...).innerHTML = ...`) 全部混雜在單一個 `app.js` 中。這種指令式 (Imperative) 的寫法，讓後續新增功能或除錯變得異常困難（典型的義大利麵條程式碼）。
*   **手機瀏覽器可用性與 UI/UX**：雖然已有部分 RWD 設計與 iOS Safe Area 的處理，但純手寫 CSS 與原生 JS 處理複雜的彈出選單 (Dropdown)、側邊欄 (Sidebar) 互動，容易產生狀態不一致 (例如：點擊空白處關閉選單的邏輯常常失效) 與奇怪的排版問題。

---

## 二、 目標技術棧建議 (The "Modern CDN" Stack)

根據您的決策：**「保持不使用建置工具」、「保留現有 CSS」、「升級邏輯框架」、「徹底解決地圖卡頓」**，以下是最佳的技術棧組合：

### 1. 樣式：維持現有 Vanilla CSS (`styles.css`)
*   **原因**：既然決定不使用 Tailwind，且目前的 UI 已經有一套完整的自訂風格（如：雙圈圖示、玻璃透視效果），保留現有 CSS 是最安全的做法。未來可逐步利用 Vue 的元件化特性，將 CSS 拆分到獨立的檔案或區塊中。

### 2. 邏輯與狀態：Vue 3 (Global Build via CDN)
*   **目的**：解決「可維護性」與「複雜 UI 互動」。
*   **優勢**：
    *   **聲明式渲染 (Declarative Rendering)**：資料變更時，畫面自動更新，再也不用手寫 `innerHTML`。
    *   **元件化 (Componentization)**：雖然不用單檔元件 (`.vue`)，但您可以將側邊欄、設定面板、地圖組件拆分成不同的 JS 物件。
    *   **零建置**：只需在 `<head>` 引入 `<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>` 即可。

### 3. 地圖引擎：MapLibre GL JS (via CDN)
*   **目的**：徹底解決「效能」與「地圖卡頓」。
*   **優勢**：
    *   **WebGL 硬體加速**：無論是 1,000 個還是 100,000 個標記，都只在顯示卡 (GPU) 的一個 Canvas 畫布上渲染，完全沒有 DOM 節點過多的問題，效能如絲毫般滑順。
    *   **強大的資料視覺化**：原生支援在圖層 (Layer) 上進行複雜的資料驅動樣式 (Data-driven styling)，非常適合您現有的「雙變數色彩映射」與「雙圈模式」。

---

## 三、 架構設計與遷移指南 (Migration Guide)

這是一份循序漸進的重構計畫，您可以依照此步驟，在不破壞現有功能的前提下，安全地將專案轉移到新架構。

### 步驟 1：準備工作與引入 CDN
1.  建立一個新的分支 (例如 `feature/vue-maplibre-refactor`)。
2.  修改 `index.html` 的 `<head>`：
    *   **移除** Leaflet 的 CSS 與 JS (`leaflet.css`, `leaflet.js`, `MarkerCluster...`)。
    *   **加入** Vue 3 與 MapLibre GL JS 的 CDN。

```html
<!-- MapLibre GL JS -->
<link href="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.js"></script>

<!-- Vue 3 (Global Build) -->
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
```

### 步驟 2：設計 Vue 3 應用程式架構 (重構 `app.js`)
不要一次把所有程式碼塞進 Vue，而是將資料(State)抽象出來。您可以將 `app.js` 拆分成以下模組（由於不使用建置工具，您可以使用 ES6 Modules：`<script type="module" src="app.js"></script>`）：

*   `api.js`：負責與後端 fetch 資料。
*   `map.js`：封裝 MapLibre 的初始化與圖層更新邏輯。
*   `app.js`：Vue 的根實體 (Root Instance)。

**Vue 狀態 (State) 設計範例：**
```javascript
const { createApp, ref, reactive, computed, watch, onMounted } = Vue;

const app = createApp({
  setup() {
    // 狀態
    const transactions = ref([]); // 取代全域 txData
    const filters = reactive({
      buildType: '',
      rooms: '',
      price: '',
      // ...
    });
    const settings = reactive({
      bubbleMode: 'dual_ring',
      themeMode: 'light',
      // ...
    });
    const ui = reactive({
      sidebarCollapsed: false,
      settingsVisible: false,
      activeTxId: null
    });

    // 取得資料
    const fetchSearch = async () => { /* 呼叫 api.js */ };

    // 監聽資料變化，通知地圖更新
    watch(transactions, (newData) => {
      // 呼叫 map.js 的渲染函式
      updateMapMarkers(newData);
    });

    return { transactions, filters, settings, ui, fetchSearch };
  }
});

app.mount('body'); // 將 Vue 掛載到 body
```

### 步驟 3：用 Vue 改寫 HTML (取代 `innerHTML`)
將原本 `index.html` 中寫死的 HTML 與 `app.js` 裡的字串拼接 (String concatenation) 改為 Vue 的模板語法 (`v-if`, `v-for`, `@click`)。

**改寫前 (Vanilla JS)：**
```javascript
html += `<div class="tx-card ${isActive ? 'active' : ''}" onclick="selectTx(${idx})">...</div>`;
document.getElementById('results').innerHTML = html;
```

**改寫後 (Vue 模板 `index.html`)：**
```html
<div id="results">
  <div v-for="tx in transactions" :key="tx.id"
       class="tx-card" :class="{ active: ui.activeTxId === tx.id }"
       @click="selectTx(tx.id)">
    <!-- 卡片內容 -->
    <div class="tx-price">{{ fmtWan(tx.price) }}</div>
  </div>
</div>
```

### 步驟 4：替換為 MapLibre GL JS (最關鍵的一步)
MapLibre 的邏輯與 Leaflet 截然不同，它不再產生 `<div>`，而是將資料餵給 GPU。

1.  **初始化地圖**：
    ```javascript
    const map = new maplibregl.Map({
      container: 'map',
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', // CartoDB 底圖
      center: [120.9605, 23.6978],
      zoom: 8
    });
    ```
2.  **將資料轉為 GeoJSON**：MapLibre 需要 GeoJSON 格式的資料才能進行高效渲染。
    ```javascript
    function txDataToGeoJSON(transactions) {
      return {
        type: 'FeatureCollection',
        features: transactions.map(tx => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [tx.lng, tx.lat] },
          properties: {
             price: tx.price,
             unit_price: tx.unit_price_ping,
             community: tx.community_name,
             // 其他用於決定樣式的屬性
          }
        }))
      };
    }
    ```
3.  **群聚 (Clustering) 與資料驅動樣式 (Data-Driven Styling)**：
    利用 MapLibre 內建的 Clustering。您可以直接在 `addSource` 中開啟 `cluster: true`。
    然後，使用 `addLayer` 的 `paint` 屬性，根據資料的 `price` 或 `unit_price` 動態改變圓圈的顏色與大小 (取代原本手刻的 SVG)。

    *提示：要在 MapLibre 中實作您的「雙圈模式 (Dual Ring)」，您可以新增兩個圖層 (Layer)，都綁定同一個 GeoJSON Source。一個圖層畫外圈（半徑較大），另一個圖層畫內圈（半徑較小）。*

### 步驟 5：測試與優化
*   **手機測試**：確保 Vue 的狀態綁定解決了原本選單點擊與側邊欄開關的 UI 錯誤。
*   **效能測試**：在手機瀏覽器上載入大量資料，體驗 MapLibre 的滑順平移與縮放。
*   **自訂樣式整合**：確保原本 `styles.css` 中針對排版與顏色的變數，能完美套用到 Vue 渲染出的 DOM 節點上。

---

## 結論

這套 **Vue 3 (CDN) + Vanilla CSS + MapLibre GL JS** 的架構，完美地在「不使用建置工具」的嚴苛條件下，解決了效能與維護性的痛點。
它將讓您的專案具備現代化前端的靈活度，同時在地圖渲染上獲得原生 App 等級的流暢體驗。
