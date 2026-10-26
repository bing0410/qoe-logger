# 網路體驗記錄器（QoE Logger）

無線網路專題的手機量測網頁。iPhone 用 Safari、Android 用 Chrome 打開就能用，不用安裝，兩邊的資料格式相同並自動上傳到同一個地方。

## 固定量測伺服器

所有手機都對同一組網址量測：

| 用途 | 網址 |
| --- | --- |
| 延遲（HTTP 往返） | `https://speed.cloudflare.com/__down?bytes=0` |
| 網速（下載） | `https://speed.cloudflare.com/__down?bytes=5000000`（背景）／`20000000`（密集） |
| 網路與機房 | `https://speed.cloudflare.com/meta`（ASN、Cloudflare 機房代碼） |

每個請求都加亂數參數並設 `cache: no-store`，避免快取。

## 量測方法

- **延遲**：每組 1 個冷請求，隔 50 ms 再連送 3 個熱請求。`net_ms` = Resource Timing 的 `responseStart − requestStart`，扣掉回應標頭 `Server-Timing` 裡的伺服器處理時間（`cfSpeedEdge` + `cfSpeedWorker`）。另外記錄 Cloudflare 回報的 TCP RTT（`tcp_rtt_ms`）與是否開新連線（`new_conn`）。
- **網速**：背景模式下載 5 MB，`mbps_effective` 含等待第一個位元組的時間（應用層體驗）。密集模式上限 3 秒或 20 MB，`mbps_steady` 扣掉前 0.5 秒或前 25% 位元組（先到者），比較接近鏈路容量。
- **錯開**：延遲、網速、上傳都不同時跑；網速結束後至少隔 1 秒才量延遲。
- **速度**：瀏覽器 GNSS 速度（`speed_src: gnss`）；沒有時用前後兩點距離 ÷ 時間推算（`derived`，兩點精度都 ≤ 30 m、間隔 1–30 秒）。
- **失敗也記**：逾時、斷線存成 `ok: false` 的紀錄。

## 自動上傳

- 網頁有網路時，每 5 分鐘把新紀錄批次上傳（每批最多 400 筆）到 Google Apps Script 端點（程式碼在 `server/Code.gs`）。
- 原始紀錄：團隊共用雲端硬碟的 `logs/qoe-logger-data/` 資料夾，一批一個 JSONL 檔。資料夾 ID 存在 Apps Script 的指令碼屬性 `FOLDER_ID`，不放在這個公開 repo。
- 延遲與網速摘要：同資料夾裡的「qoe-logger 量測總表」，一筆量測一列，用「平台」欄區分 iPhone 和 Android。總表只給人看，分析只讀 JSONL。
- 需要隊伍密碼：組長傳的連結（網址後面有 `#key=…`）打開一次就會記住，密碼不放在 repo 裡。
- 網路斷掉時重送可能造成少數重複，分析時用 `id` 去重。

## 資料格式（v0.3.0，schema v1，JSONL 一行一筆）

共同欄位：

```
v, app, id, type, t (ISO), ts (epoch ms), session,
dev: { device_id, member, platform, detected, model },
net: { carrier, carrier_name, mcc, mnc, plan_5g, rat_pref, network_type, asn, as_org, colo, meta_ts, conn },
loc: { lat, lon, acc, alt, alt_acc, speed, speed_src, speed_acc, heading, ts, fix_age_ms } | null
```

`type` 決定其餘欄位：

- `rtt`：`rtt: { ok, err, idle_gap_ms, cold_ms, hot_median_ms, hot_ok, hot_n, basis, clock_offset_ms, cold: {...}, hot: [{...}] }`。`clock_offset_ms` = 伺服器時間（回應標頭 `cf-meta-request-time`）減去（手機送出時間＋半個往返），用來檢查手機時鐘準不準。
- `tput`：`tput: { mode, ok, err, bytes, req_bytes, complete, cap, total_ms, ttfb_ms, mbps, mbps_effective, mbps_body, mbps_steady, steady_rule }`。背景模式的 `mbps_steady`、`steady_rule` 一律是 `null`。
- `fix`：只有位置（連續記錄時每 5 秒一筆）
- `net`：ASN 或機房改變時記一筆
- `session`：開始、停止、切到背景、回到前景、切換模式

平台差異：

- `platform`：第一次使用時選 iPhone 或 Android（依瀏覽器預填），記成 `ios-web` 或 `android-web`；`detected` 是瀏覽器判斷的結果（另有 `desktop-web`）。
- `member`：從組員名單選；`carrier` 是 `MCC-MNC`（例如 `466-92`），`carrier_name` 是電信商名稱。
- `as_org`：開始記錄前會先查一次 `/meta`，每筆都帶 `as_org`；`meta_ts` 是最後一次查到的時間。iCloud 私密轉送開著時 ASN 會是 13335（Cloudflare）。
- `net.conn`：只有 Android Chrome 有（Network Information API）：`type`（cellular／wifi）、`effective`（Chrome 估的 4g／3g）、`downlink_mbps`、`rtt_ms`。iPhone 是 `null`。`type` 是 `wifi` 時網頁會提醒關 Wi-Fi。
- `network_type`：只有在使用者設定「只用 4G」時記成 `LTE`（`rat_pref: lte_only`），否則是 `null`。
- 瀏覽器在兩個平台都讀不到 RSRP、PCI、基地台編號。Android 另外用 Network Survey app 記錄，再用時間和網頁紀錄對齊。

舊版（v0.2.x）的差異：`carrier` 是中文名稱（請用 `mcc`＋`mnc`）、`member` 是自由輸入、沒有 `detected`／`carrier_name`／`meta_ts`／`clock_offset_ms`，背景模式的 `mbps_steady` 可能有值。舊手機打開 v0.3.0 時會要求確認一次手機類型和名字。

## 檔案

- `index.html`：整個網頁（不需要建置）
- `sw.js`：離線快取，只快取本站檔案，不碰量測請求
- `manifest.webmanifest`、`icon-*.png`：加入主畫面用
- `server/Code.gs`：上傳端點（Google Apps Script）
