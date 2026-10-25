# 網路體驗記錄器（QoE Logger）

無線網路專題的手機量測網頁。iPhone 用 Safari 打開就能用，不用安裝；Android 也能開，但 Android 主力是之後的背景 app。

## 固定量測伺服器

Android app 和這個網頁對同一組網址量測：

| 用途 | 網址 |
| --- | --- |
| 延遲（HTTP 往返） | `https://speed.cloudflare.com/__down?bytes=0` |
| 網速（下載） | `https://speed.cloudflare.com/__down?bytes=5000000`（背景）／`20000000`（密集） |
| 網路與機房 | `https://speed.cloudflare.com/meta`（ASN、Cloudflare 機房代碼） |

每個請求都加亂數參數並設 `cache: no-store`，避免快取。

## 量測方法

- **延遲**：每組 1 個冷請求，隔 50 ms 再連送 3 個熱請求。`net_ms` = Resource Timing 的 `responseStart − requestStart`，扣掉回應標頭 `Server-Timing` 裡的伺服器處理時間（`cfSpeedEdge` + `cfSpeedWorker`）。另外記錄 Cloudflare 回報的 TCP RTT（`tcp_rtt_ms`）與是否開新連線（`new_conn`）。
- **網速**：背景模式下載 5 MB，`mbps_effective` 含等待第一個位元組的時間（應用層體驗）。密集模式上限 3 秒或 20 MB，`mbps_steady` 扣掉前 0.5 秒或前 25% 位元組（先到者），比較接近鏈路容量。
- **錯開**：延遲和網速不同時跑；網速結束後至少隔 1 秒才量延遲。
- **速度**：瀏覽器 GNSS 速度（`speed_src: gnss`）；沒有時用前後兩點距離 ÷ 時間推算（`derived`，兩點精度都 ≤ 30 m、間隔 1–30 秒）。
- **失敗也記**：逾時、斷線存成 `ok: false` 的紀錄。

## 資料格式（schema v1，JSONL 一行一筆）

共同欄位：

```
v, app, id, type, t (ISO), ts (epoch ms), session,
dev: { device_id, member, platform, model },
net: { carrier, mcc, mnc, plan_5g, rat_pref, network_type, asn, as_org, colo },
loc: { lat, lon, acc, alt, alt_acc, speed, speed_src, speed_acc, heading, ts, fix_age_ms } | null
```

`type` 決定其餘欄位：

- `rtt`：`rtt: { ok, err, idle_gap_ms, cold_ms, hot_median_ms, hot_ok, hot_n, basis, cold: {...}, hot: [{...}] }`
- `tput`：`tput: { mode, ok, err, bytes, req_bytes, complete, cap, total_ms, ttfb_ms, mbps, mbps_effective, mbps_body, mbps_steady, steady_rule }`
- `fix`：只有位置（連續記錄時每 5 秒一筆）
- `net`：ASN 或機房改變時記一筆
- `session`：開始、停止、切到背景、回到前景、切換模式

iPhone 讀不到的欄位一律是 `null`（例如 `speed_acc`）。`network_type` 只有在使用者設定「只用 4G」時記成 `LTE`（`rat_pref: lte_only`），否則是 `null`。Android app 沿用同一組欄位，再加上 cell 資訊。

## 檔案

- `index.html`：整個網頁（不需要建置）
- `sw.js`：離線快取，只快取本站檔案，不碰量測請求
- `manifest.webmanifest`、`icon-*.png`：加入主畫面用
