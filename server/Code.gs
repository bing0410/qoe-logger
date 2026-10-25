/**
 * 網路體驗記錄器：上傳端點（Google Apps Script 網頁應用程式）
 * - 每批原始紀錄存成一個 JSONL 檔，放在雲端硬碟「qoe-logger-data」資料夾
 * - 延遲（rtt）與網速（tput）另外各寫一列到「qoe-logger 量測總表」
 * 第一次使用：在編輯器執行 setup()，授權後到「執行作業記錄」看隊伍密碼與連結。
 * 部署：網頁應用程式，執行身分「我」，存取權「所有人」。
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

/** 刪掉組員名稱為 _test 的測試資料（檔案移到垃圾桶，可以復原）。 */
function cleanupTest() {
  const folder = getFolder_();
  const it = folder.getFiles();
  let files = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('__test_') >= 0) { f.setTrashed(true); files++; }
  }
  const sh = getSheet_(folder);
  const vals = sh.getDataRange().getValues();
  let rows = 0;
  for (let i = vals.length - 1; i >= 1; i--) {
    if (vals[i][1] === '_test') { sh.deleteRow(i + 1); rows++; }
  }
  console.log('trashed files=' + files + ', deleted rows=' + rows);
}

function row_(r) {
  const d = r.dev || {}, n = r.net || {}, l = r.loc || {}, x = r.rtt || {}, t = r.tput || {};
  return [
    Utilities.formatDate(new Date(r.ts), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    d.member || '', d.platform || '', d.model || '', n.carrier || '', n.rat_pref || '', v_(n.asn), n.colo || '', r.type,
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
