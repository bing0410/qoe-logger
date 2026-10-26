/**
 * 網路體驗記錄器：上傳端點（Google Apps Script 網頁應用程式）
 * - 每批原始紀錄存成一個 JSONL 檔，放進 Script Properties 裡 FOLDER_ID 指到的資料夾
 *   （團隊用的是共用 Drive 的 logs/qoe-logger-data/）
 * - 延遲（rtt）與網速（tput）另外各寫一列到同資料夾的「qoe-logger 量測總表」（只給人看，不是 pipeline 輸入）
 * 第一次使用：在編輯器執行 setup()，授權後到「執行作業記錄」看隊伍密碼與連結。
 * 部署：網頁應用程式，執行身分「我」，存取權「所有人」。
 *
 * 資料夾 ID 不寫進這個公開 repo：共用資料夾開著「知道連結就能編輯」，ID 就等於連結。
 * 換資料夾：專案設定 → 指令碼屬性，新增 TARGET_FOLDER_ID = 新資料夾 ID，再執行 moveToTargetFolder()。
 * logs/ 只能新增檔案，不能修改或刪除，所以這支程式不會刪除資料夾裡的任何檔案。
 */
const FOLDER_NAME = 'qoe-logger-data';
const SHEET_NAME = 'qoe-logger 量測總表';
const HEADER = ['時間', '組員', '平台', '手機型號', '電信商', '網路模式', 'ASN', '機房', '類型',
  '緯度', '經度', '定位精度_m', '速度_mps', '速度來源', '熱延遲_ms', '冷延遲_ms', '延遲成功',
  '網速_Mbps', '網速模式', '網速成功', '下載位元組', '連線階段', '紀錄ID'];

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEAM_KEY')) {
    props.setProperty('TEAM_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 10));
  }
  const folder = getFolder_();
  const sheet = getSheet_(folder);
  console.log('TEAM_KEY=' + props.getProperty('TEAM_KEY'));
  console.log('FOLDER=' + folder.getUrl());
  console.log('SHEET=' + sheet.getParent().getUrl());
}

/**
 * 把目前資料夾裡的所有檔案（JSONL 批次與量測總表）移到 TARGET_FOLDER_ID，之後的上傳都寫進新資料夾。
 * 舊資料夾留空、不刪除。只移動，不複製也不改檔案內容。
 */
function moveToTargetFolder() {
  const props = PropertiesService.getScriptProperties();
  const targetId = props.getProperty('TARGET_FOLDER_ID');
  if (!targetId) throw new Error('先在「專案設定 → 指令碼屬性」新增 TARGET_FOLDER_ID');
  const target = DriveApp.getFolderById(targetId);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const oldId = props.getProperty('FOLDER_ID');
    let moved = 0;
    if (oldId && oldId !== targetId) {
      const it = DriveApp.getFolderById(oldId).getFiles();
      while (it.hasNext()) { it.next().moveTo(target); moved++; }
    }
    props.setProperty('FOLDER_ID', targetId);
    props.deleteProperty('TARGET_FOLDER_ID');
    let left = 0;
    if (oldId && oldId !== targetId) { const it2 = DriveApp.getFolderById(oldId).getFiles(); while (it2.hasNext()) { it2.next(); left++; } }
    console.log('moved=' + moved + ', left_in_old=' + left + ', target=' + target.getName());
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, service: 'qoe-logger' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
    if (!key || body.key !== key) return json_({ ok: false, err: 'bad_key' });
    if (body.ping) return json_({ ok: true, ping: true });
    const recs = Array.isArray(body.records) ? body.records : [];
    if (!recs.length) return json_({ ok: true, n: 0 });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const folder = getFolder_();
      const r0 = recs[0];
      const member = clean_((r0.dev && r0.dev.member) || 'anon');
      const dev = clean_((r0.dev && r0.dev.device_id) || 'unknown').slice(0, 8);
      const stamp = Utilities.formatDate(new Date(r0.ts || Date.now()), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
      const name = stamp + '_' + member + '_' + dev + '_' + recs.length + '.jsonl';
      const text = recs.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n';
      folder.createFile(name, text, 'application/x-ndjson');

      const rows = recs.filter(function (r) { return r.type === 'rtt' || r.type === 'tput'; }).map(row_);
      if (rows.length) {
        const sh = getSheet_(folder);
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
      }
      return json_({ ok: true, n: recs.length, rows: rows.length, file: name });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, err: String(err) });
  }
}

function row_(r) {
  const d = r.dev || {}, n = r.net || {}, l = r.loc || {}, x = r.rtt || {}, t = r.tput || {};
  return [
    Utilities.formatDate(new Date(r.ts), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    d.member || '', d.platform || '', d.model || '', n.carrier_name || n.carrier || '', n.rat_pref || '', v_(n.asn), n.colo || '', r.type,
    v_(l.lat), v_(l.lon), v_(l.acc), v_(l.speed), l.speed_src || '',
    v_(x.hot_median_ms), v_(x.cold_ms), r.type === 'rtt' ? !!x.ok : '',
    v_(t.mbps), t.mode || '', r.type === 'tput' ? !!t.ok : '', v_(t.bytes),
    r.session || '', r.id || ''
  ];
}

function getFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function getSheet_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) {} }
  const ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const sh = ss.getSheets()[0];
  sh.setName('量測');
  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  props.setProperty('SHEET_ID', ss.getId());
  return sh;
}

function v_(x) { return (x === null || x === undefined) ? '' : x; }
function clean_(s) { return String(s).replace(/[^\w一-鿿-]/g, '').slice(0, 24) || 'x'; }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
