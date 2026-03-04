# 良富居地產 — 前端

> 靜態純前端，可直接部署至 GitHub Pages。

## 功能

- 🗺️ Leaflet 互動地圖 + 群聚 marker
- 🔍 關鍵字搜尋 / 建案自動完成 / 區域搜尋
- 🎨 雙圈模式（Dual Ring）+ 雙變數色彩（Bivariate 4×4）
- 📊 建案統計 / 篩選 / 排序
- 📱 響應式設計（桌面 + 手機）
- 🎨 美化下拉箭頭、調整自動完成位置與複選框樣式
- 🧹 處理彈出層互相蓋住的問題；點 cluster 後加入模糊背景
- 🔡 注音輸入時不會提早搜尋，避免文字未確認即發查詢
- 📐 手機版列表項目居中且有合理寬度
- 🚫 `noindex, nofollow`：不被搜尋引擎收錄

## 部署

### GitHub Pages
1. 將此 repo push 到 GitHub
2. 在 Settings → Pages 選擇 `main` 分支 → root
3. 完成

### 本機預覽
```bash
# 任意靜態伺服器
python3 -m http.server 8080
# 或
npx serve .
```

## 變更紀錄

- 2026‑03‑xx 效能優化:
  * 前端虛擬滾動：建案群組內預設只渲染 10 筆，點「顯示更多」按需載入
  * 搭配後端 R\*Tree + community_cache 快取表，搜尋附近建案從 ~700ms 降至 ~240ms
- 2026‑03‑04 針對使用者報告修正:
  * 下拉清單美化、選單重疊與 z-index 問題
  * 自動完成位置與手機置中佈局
  * 群聚清單 overlay 加背景模糊
  * IME (注音/拼音) 組字期間暫停搜尋觸發
- 2026‑03‑04 後端調整完工日期欄位：API 現在傳送純 ROC 數字字串（`11305`），前端負責格式化，避免 NaN 問題

## API 端點

前端預設連線至：
```
https://volodos.cs.nthu.edu.tw:5001
```
如需修改，編輯 `app.js` 第一行的 `API_BASE` 常數。

### 資料格式提醒
- `completion_date` 現在由後端送出原始民國編碼（例如 `"11305"`）。前端會根據設定顯示 ROC 或 CE 格式。

## 檔案結構

```
frontend/
├── index.html   # 主頁面
├── styles.css   # 樣式（白色主題）
├── app.js       # 應用邏輯
└── README.md
```

## 技術

- **地圖**: Leaflet 1.9.4 + Leaflet.markercluster 1.5.3
- **樣式**: 純 CSS（無框架），CSS Variables
- **JS**: 純 Vanilla JS（無框架/打包工具）
