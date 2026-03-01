# 良富居地產 — 前端

> 靜態純前端，可直接部署至 GitHub Pages。

## 功能

- 🗺️ Leaflet 互動地圖 + 群聚 marker
- 🔍 關鍵字搜尋 / 建案自動完成 / 區域搜尋
- 🎨 雙圈模式（Dual Ring）+ 雙變數色彩（Bivariate 4×4）
- 📊 建案統計 / 篩選 / 排序
- 📱 響應式設計（桌面 + 手機）
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

## API 端點

前端預設連線至：
```
http://140.114.78.136:5001
```
如需修改，編輯 `app.js` 第一行的 `API_BASE` 常數。

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
