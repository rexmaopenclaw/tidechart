# Wind Card Changes — 2026-08-10

## 改動總結

### 1. Server (`server/index.js`)
- **`/api/hko-wind` endpoint**: 改 `nearest` 由單一站變做 array of 3（最近 3 個站）
- **HKO_WIND_STATIONS list**: 30 個站坐標，用嚟計距離 match CSV
- 每個 nearest item 有：`station`, `wind_dir`, `wind_speed`, `wind_gust`, `station_lat`, `station_lon`, `distance_km`

### 2. HTML (`index.html`)
- 風卡由原本嘅 forecast wind 完全改做 **HKO 天文台實時風站卡**
- 加咗 `<select id="windStationSelect">` dropdown 揀最近 3 個站
- 加咗風向箭嘴元素 `<span id="windHkoDirArrow">↑</span>`
- 加咗 layout：大風速、陣風、風向、站點、距離、更新時間
- **預報風卡** 搬咗落 cards-row 下面做獨立 reference card (`#forecastWindCard`)

### 3. CSS (`style.css`)
- `.wind-station-select` — dropdown 樣式
- `.hko-wind-main` / `.hko-speed-val` / `.hko-speed-unit` — 大風速顯示
- `.hko-wind-details` — grid 2 欄佈局（陣風、風向、站點、距離、更新）
- `.dir-arrow-hko` — 風向箭嘴，有 rotate transition
- `.dir-row-full` — 風向行跨 2 欄
- `.dir-hko-wrap` — 箭嘴 + 文字 flex
- `.forecast-wind-card` / `.forecast-wind-body` — 預報風卡樣式

### 4. JS (`app.js`)

#### 新增
- `DIR_NAMES` — 中文風向字（北、東北、西南...）
- `degToCompass(deg)` — degree → 16 方位英文縮寫
- `hkoWindDirToDeg(dirStr)` — **將天文台文字風向（"Southwest"）轉 degree（225°）**
  - 支援 32 方位 mapping（N, NNE, NE, ENE, E...）
  - 回傳 `null` 如果係 Calm/Variable/N/A
- `state.hkoWind: null` — 儲存 HKO wind API 結果
- DOM refs: `windStationSelect`, `windHkoSpeed`, `windHkoUnit`, `windHkoGust`, `windHkoDir`, `windHkoDirArrow`, `windHkoStation`, `windHkoDist`, `windHkoTime`

#### 改動
- **`loadData()`**: 加咗 parallel fetch `/api/hko-wind` 同一時間 call
- **`renderHkoWind()`** (全新):
  - 時間檢查：只有 `selectedDate === today && |selectedMinutes - currentMinutes| <= 15` 先顯示
  - 否則成張卡 hidden（因為 HKO 無歷史數據）
  - Populate dropdown 從 nearest 3 個站
  - 預設揀第一個站
- **`showHkoWindStation(idx)`** (全新):
  - 顯示揀中嘅站嘅數據
  - **HKO CSV 係 km/h 原數據**，kn mode 要 ÷1.852
  - 風向箭嘴指向 **風吹去嘅方向**（meteorological FROM + 180°）
  - 顯示 bearing degree（如「西南 (225°)」）
  - 顯示站名、距離、更新時間
- **`renderForecastWind()`** — 保留原有 GFS + ECMWF 邏輯，但放喺獨立 card
- **`toggleWindUnit()`** — 更新埋兩個 wind card
- Dropdown change event listener — 轉 station 即時更新顯示

## ⚠️ 重要筆記
- 天文台 CSV 風速係 **km/h**，唔係 knot
- 風向係文字（"Southwest"），server 冇轉 degree，frontend 用 `hkoWindDirToDeg()` mapping
- 風向箭嘴用 **meteorological FROM + 180°** = 指向風吹去嘅方向（同水流箭嘴 convention 一致）
- 預報風（GFS/ECMWF）係 model forecast，任何時間都顯示
- 天文台風只有揀「現在時間」先顯示