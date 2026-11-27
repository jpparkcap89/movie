/**
 * 링크 저장소 — GAS 백엔드
 * 구글 시트에 묶인(컨테이너 바인딩) Apps Script 프로젝트에 붙여넣어 사용하세요.
 *
 * 프론트엔드(GitHub Pages)는 이 웹 앱 주소로 POST(text/plain, JSON 본문)를 보냅니다.
 * 모든 요청에는 비밀 키(key)가 있어야 합니다. 키는 setup 실행 시 만들어져 스크립트 속성 API_KEY에 저장돼요.
 *   action: 'analyze'  { key, url }                                  → 게시물 분석, 저장 가능한 항목 목록
 *   action: 'download' { key, mediaUrl, platform, type, sourceUrl }  → 파일 받기(작으면 GAS가 대신 받아 base64로, 크면 원본 링크)
 *   action: 'drive'    { key, mediaUrl, platform, type, sourceUrl }  → 구글 드라이브에 바로 저장(큰 영상도 조각으로 나눠 올림)
 *   action: 'stats'    { key }                                       → 오늘 사용량
 */

const CONFIG = {
  PER_IP_DAILY: 100,                             // 하루 다운로드 횟수 상한 (실수로 반복 호출하는 것을 막는 안전장치)
  GLOBAL_BYTES_DAILY: 10 * 1024 * 1024 * 1024,   // 하루 전체 전송량 (10 GiB)
  MAX_PROXY_BYTES: 20 * 1024 * 1024,             // GAS가 대신 받아 줄 최대 크기 (UrlFetch 한도 50MB, base64 변환 고려)
  TIMEZONE: 'Asia/Seoul',
  SPREADSHEET_ID: '1fFACt6f1jf7ngm0o7xJopxii8CpPV1MaHLO9cqQ6v-o', // 기록용 구글 시트 (시트에 묶인 프로젝트가 아니어도 동작하도록)
  DRIVE_FOLDER_ID:'1rRPkvqpbZb5XInxFz0-wx74p_fKEZKn5', // 저장할 드라이브 폴더 (주소의 folders/ 뒤 부분). 비우면 아래 이름으로 새 폴더를 만듭니다
  DRIVE_FOLDER_NAME: '링크 저장소',
  DRIVE_CHUNK_BYTES: 32 * 1024 * 1024,           // 드라이브로 나눠 올리는 조각 크기 (256KiB의 배수여야 함)
  TIME_BUDGET_MS: 5 * 60 * 1000,                 // GAS 6분 제한 전에 멈추기
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// 분석할 수 있는 게시물 주소
const SOURCE_HOSTS = [
  { re: /(^|\.)youtube\.com$|^youtu\.be$/, platform: 'youtube' },
  { re: /(^|\.)instagram\.com$/, platform: 'instagram' },
  { re: /(^|\.)threads\.(net|com)$/, platform: 'threads' },
  { re: /(^|\.)facebook\.com$|^fb\.watch$/, platform: 'facebook' },
];

// GAS가 대신 받아 줄 수 있는 파일 주소 (아무 주소나 받아 주는 중계기가 되지 않도록 제한)
const MEDIA_HOSTS = [/\.cdninstagram\.com$/, /\.fbcdn\.net$/, /^i\.ytimg\.com$/, /^img\.youtube\.com$/];

/* ───────────────────────── 진입점 ───────────────────────── */

function doGet() {
  return json_({ ok: true, message: '링크 저장소 API가 동작 중이에요.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!secret) throw new Error('스크립트 속성에 API_KEY가 없어요. setup 함수를 먼저 실행해 주세요.');
    if (body.key !== secret) return json_({ ok: false, auth: false, error: '비밀 키가 맞지 않아요.' });
    const ip = 'me'; // 혼자 쓰는 앱이라 사용자 구분 없이 하나로 셉니다.
    switch (body.action) {
      case 'analyze':
        return json_({ ok: true, result: analyze_(String(body.url || '').trim()), stats: stats_(ip) });
      case 'download':
        return json_(download_(ip, body));
      case 'drive':
        return json_(saveToDrive_(ip, body));
      case 'stats':
        return json_({ ok: true, stats: stats_(ip) });
      // ── PC 도우미용 (YouTube 영상) ──
      case 'queue':
        return json_(queueAdd_(ip, body));
      case 'jobs':
        return json_({ ok: true, jobs: queueTake_() });
      case 'uploadSession':
        return json_(uploadSession_(body));
      case 'jobDone':
        return json_(queueDone_(ip, body));
      default:
        return json_({ ok: false, error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/** 처음 한 번 실행: 시트를 만듭니다. */
function setup() {
  const ss = book_();
  ensureSheet_(ss, 'logs', ['시각', 'IP', '플랫폼', '종류', '바이트', '방식', '게시물 주소']);
  const c = ensureSheet_(ss, 'counters', ['키', '날짜', '구분', 'IP', '횟수', '바이트']);
  c.getRange('A:D').setNumberFormat('@');
  queueSheet_();

  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_KEY', key);
  }
  Logger.log('비밀 키(API_KEY): ' + key + '\n이 키를 웹 화면에 처음 한 번 입력하세요. 바꾸려면 resetKey를 실행하세요.');
}

/** 비밀 키를 새로 만듭니다(예전 키는 더 이상 쓸 수 없어요). */
function resetKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  setup();
}

/* ───────────────────────── 분석 ───────────────────────── */

function analyze_(url) {
  const host = hostOf_(url);
  if (!host) throw new Error('올바른 링크가 아니에요. https:// 로 시작하는 주소를 넣어 주세요.');
  const src = SOURCE_HOSTS.find(s => s.re.test(host));
  if (!src) throw new Error('YouTube, Instagram, Threads, Facebook 링크만 지원해요.');

  if (src.platform === 'youtube') return analyzeYouTube_(url);

  const html = fetchText_(url);
  const meta = parseMeta_(html);
  const items = [];
  const seen = {};
  const add = (type, rawUrl, w, h) => {
    if (!rawUrl) return;
    const u = unescapeUrl_(rawUrl);
    if (!/^https:\/\//.test(u) || !isMediaHost_(hostOf_(u))) return;
    const key = u.split('?')[0];
    if (seen[key]) return;
    seen[key] = true;
    items.push({ type: type, url: u, width: w || null, height: h || null });
  };

  // 페이지 안의 JSON에서 원본 파일 주소 찾기
  if (src.platform === 'facebook') {
    ['browser_native_hd_url', 'playable_url_quality_hd', 'browser_native_sd_url', 'playable_url']
      .forEach(k => matchAll_(html, new RegExp('"' + k + '":"([^"]+)"', 'g')).forEach(m => add('video', m[1])));
  }
  matchAll_(html, /"video_url":"([^"]+)"/g).forEach(m => add('video', m[1]));
  matchAll_(html, /"video_versions":\[\{[^\]]*?"url":"([^"]+)"/g).forEach(m => add('video', m[1]));
  matchAll_(html, /"display_url":"([^"]+)"/g).forEach(m => add('image', m[1]));
  matchAll_(html, /"image_versions2":\{"candidates":\[\{([^}]*)\}/g).forEach(m => {
    const u = /"url":"([^"]+)"/.exec(m[1]);
    const w = /"width":(\d+)/.exec(m[1]);
    const h = /"height":(\d+)/.exec(m[1]);
    if (u) add('image', u[1], w && +w[1], h && +h[1]);
  });

  // 못 찾으면 공유용 메타 태그(og:video, og:image)로 대신
  if (!items.some(i => i.type === 'video')) add('video', meta['og:video:secure_url'] || meta['og:video']);
  if (!items.length) add('image', meta['og:image'] || meta['twitter:image']);

  if (!items.length) {
    throw new Error('저장할 파일을 찾지 못했어요. 공개 게시물이 맞는지 확인해 주세요. ' +
      '공개 게시물인데도 안 되면 플랫폼이 구글 서버의 요청을 막은 거예요.');
  }

  let vi = 0, ii = 0;
  items.forEach(it => {
    const size = it.width && it.height ? ' · ' + it.width + '×' + it.height : '';
    it.label = it.type === 'video' ? '영상 ' + (++vi) + ' · MP4' : '사진 ' + (++ii) + size;
  });

  return {
    platform: src.platform,
    sourceUrl: url,
    title: decodeEntities_(meta['og:title'] || meta['twitter:title'] || meta['title'] || '제목 없음'),
    description: decodeEntities_(meta['og:description'] || ''),
    thumbnail: unescapeUrl_(meta['og:image'] || (items.find(i => i.type === 'image') || {}).url || ''),
    items: items,
  };
}

function analyzeYouTube_(url) {
  const id = (/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(url) || [])[1];
  if (!id) throw new Error('YouTube 영상 주소에서 영상 ID를 찾지 못했어요.');
  const res = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('YouTube 영상 정보를 가져오지 못했어요. 공개 영상인지 확인해 주세요.');
  const o = JSON.parse(res.getContentText());
  return {
    platform: 'youtube',
    sourceUrl: url,
    title: o.title,
    author: o.author_name,
    thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
    note: 'YouTube 영상은 내 PC의 도우미가 받아서 드라이브에 올려요. "드라이브로"를 누르면 대기열에 들어가고, PC가 켜져 있으면 몇 분 안에 처리돼요.',
    items: [
      { type: 'video', url: 'https://www.youtube.com/watch?v=' + id, label: '영상 · PC 도우미로 드라이브에 저장', queue: true },
      { type: 'image', url: 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', label: '썸네일 · 최대 해상도' },
      { type: 'image', url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', label: '썸네일 · 고화질' },
    ],
  };
}

/* ───────────────────────── 다운로드 ───────────────────────── */

function download_(ip, body) {
  const mediaUrl = String(body.mediaUrl || '');
  if (!/^https:\/\//.test(mediaUrl) || !isMediaHost_(hostOf_(mediaUrl))) throw new Error('받을 수 없는 파일 주소예요.');

  const before = stats_(ip);
  if (before.myCount >= CONFIG.PER_IP_DAILY) throw new Error('오늘 받을 수 있는 횟수(' + CONFIG.PER_IP_DAILY + '회)를 모두 썼어요. 내일 다시 이용해 주세요.');
  if (before.totalBytes >= CONFIG.GLOBAL_BYTES_DAILY) throw new Error('오늘 전체 전송량 한도를 넘었어요. 내일 다시 이용해 주세요.');

  const platform = String(body.platform || '');
  const type = body.type === 'video' ? 'video' : 'image';
  const sourceUrl = String(body.sourceUrl || '').slice(0, 500);

  let blob = null;
  try {
    const res = UrlFetchApp.fetch(mediaUrl, { headers: { 'User-Agent': UA }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) blob = res.getBlob();
  } catch (err) {
    blob = null; // 50MB 넘는 파일 등 — 원본 링크로 넘깁니다.
  }

  if (blob && blob.getBytes().length <= CONFIG.MAX_PROXY_BYTES) {
    const bytes = blob.getBytes();
    const mime = blob.getContentType() || (type === 'video' ? 'video/mp4' : 'image/jpeg');
    const stats = record_(ip, platform, type, bytes.length, 'proxy', sourceUrl);
    return {
      ok: true, mode: 'proxy', mime: mime, bytes: bytes.length,
      filename: fileName_(platform, mime, type),
      base64: Utilities.base64Encode(bytes),
      stats: stats,
    };
  }

  // 크기가 크거나 GAS가 못 받은 파일: 원본 링크를 돌려주고 횟수만 기록 (전송량은 알 수 없어 0)
  const stats = record_(ip, platform, type, 0, 'direct', sourceUrl);
  return { ok: true, mode: 'direct', url: mediaUrl, filename: fileName_(platform, '', type), stats: stats };
}

/* ───────────────────────── 구글 드라이브 저장 ───────────────────────── */

function saveToDrive_(ip, body) {
  const started = Date.now();
  const mediaUrl = String(body.mediaUrl || '');
  if (!/^https:\/\//.test(mediaUrl) || !isMediaHost_(hostOf_(mediaUrl))) throw new Error('받을 수 없는 파일 주소예요.');

  const before = stats_(ip);
  if (before.myCount >= CONFIG.PER_IP_DAILY) throw new Error('오늘 받을 수 있는 횟수(' + CONFIG.PER_IP_DAILY + '회)를 모두 썼어요.');
  if (before.totalBytes >= CONFIG.GLOBAL_BYTES_DAILY) throw new Error('오늘 전체 전송량 한도를 넘었어요.');

  const platform = String(body.platform || '');
  const type = body.type === 'video' ? 'video' : 'image';
  const sourceUrl = String(body.sourceUrl || '').slice(0, 500);
  const folder = driveFolder_();
  const token = ScriptApp.getOAuthToken();
  const CHUNK = CONFIG.DRIVE_CHUNK_BYTES;

  let start = 0, total = null, session = null, mime = null, name = null, fileId = null;

  while (total === null || start < total) {
    if (Date.now() - started > CONFIG.TIME_BUDGET_MS) {
      throw new Error('파일이 너무 커서 GAS 실행 시간(6분) 안에 다 올리지 못했어요. (' + formatMiB_(start) + ' / ' + formatMiB_(total) + ')');
    }

    const res = UrlFetchApp.fetch(mediaUrl, {
      headers: { 'User-Agent': UA, 'Range': 'bytes=' + start + '-' + (start + CHUNK - 1) },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const headers = res.getAllHeaders();

    // 서버가 나눠 받기를 지원하지 않고 파일 전체를 준 경우 (50MB 이하일 때만 여기까지 옴)
    if (code === 200 && start === 0) {
      const blob = res.getBlob();
      mime = (blob.getContentType() || (type === 'video' ? 'video/mp4' : 'image/jpeg')).split(';')[0];
      name = fileName_(platform, mime, type);
      const file = folder.createFile(blob.setName(name));
      const size = blob.getBytes().length;
      const stats = record_(ip, platform, type, size, 'drive', sourceUrl);
      return { ok: true, mode: 'drive', fileId: file.getId(), url: file.getUrl(), name: name, bytes: size, stats: stats };
    }
    if (code !== 206) throw new Error('원본 파일을 받지 못했어요 (HTTP ' + code + '). 링크를 다시 분석한 뒤 시도해 주세요.');

    const range = /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(header_(headers, 'Content-Range') || '');
    if (!range) throw new Error('파일 크기를 알 수 없어요.');
    total = Number(range[3]);
    const bytes = res.getContent();

    if (!session) {
      mime = String(header_(headers, 'Content-Type') || (type === 'video' ? 'video/mp4' : 'image/jpeg')).split(';')[0];
      name = fileName_(platform, mime, type);
      session = startResumable_(token, name, mime, total, folder.getId());
    }

    const last = start + bytes.length - 1;
    const up = UrlFetchApp.fetch(session, {
      method: 'put',
      contentType: mime,
      payload: bytes,
      headers: { Authorization: 'Bearer ' + token, 'Content-Range': 'bytes ' + start + '-' + last + '/' + total },
      muteHttpExceptions: true,
    });
    const upCode = up.getResponseCode();
    if (upCode === 200 || upCode === 201) {
      fileId = JSON.parse(up.getContentText()).id;
      break;
    }
    if (upCode !== 308) throw new Error('드라이브 업로드에 실패했어요 (HTTP ' + upCode + '): ' + up.getContentText().slice(0, 200));
    start = last + 1;
  }

  if (!fileId) throw new Error('드라이브 업로드가 끝나지 않았어요.');
  const stats = record_(ip, platform, type, total, 'drive', sourceUrl);
  return {
    ok: true, mode: 'drive', fileId: fileId, name: name, bytes: total,
    url: 'https://drive.google.com/file/d/' + fileId + '/view', stats: stats,
  };
}

function startResumable_(token, name, mime, total, folderId) {
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ name: name, parents: [folderId] }),
    headers: { Authorization: 'Bearer ' + token, 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(total) },
    muteHttpExceptions: true,
  });
  const loc = header_(res.getAllHeaders(), 'Location');
  if (res.getResponseCode() !== 200 || !loc) throw new Error('드라이브 업로드를 시작하지 못했어요 (HTTP ' + res.getResponseCode() + ').');
  return loc;
}

function driveFolder_() {
  if (CONFIG.DRIVE_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    } catch (e) {
      throw new Error('저장 폴더를 열 수 없어요. 웹 앱을 배포한 구글 계정이 이 폴더의 소유자이거나 편집자인지 확인해 주세요.');
    }
  }
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 지워진 폴더면 새로 만듭니다 */ }
  }
  const it = DriveApp.getRootFolder().getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(CONFIG.DRIVE_FOLDER_NAME);
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function header_(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  const v = key ? headers[key] : null;
  return Array.isArray(v) ? v[0] : v;
}

function formatMiB_(n) {
  return n == null ? '?' : (n / 1024 / 1024).toFixed(1) + ' MiB';
}

/* ───────────────────────── 사용량 (구글 시트) ───────────────────────── */

function stats_(ip) {
  const sh = sheet_('counters');
  const d = today_();
  const mine = readCounter_(sh, d + '|ip|' + ip);
  const total = readCounter_(sh, d + '|total');
  return {
    myCount: mine.count, perIpLimit: CONFIG.PER_IP_DAILY,
    totalCount: total.count, totalBytes: total.bytes, globalBytesLimit: CONFIG.GLOBAL_BYTES_DAILY,
    queued: queueCount_(),
  };
}

/* ───────────────────────── PC 도우미 대기열 (queue 시트) ─────────────────────────
   웹 화면 → queue(대기) → PC 도우미가 jobs로 가져감(처리 중) → uploadSession으로 드라이브 업로드 주소를 받아
   직접 올림 → jobDone으로 완료/실패 기록 */

const Q = { ID: 1, AT: 2, STATE: 3, URL: 4, TITLE: 5, FILE: 6, BYTES: 7, NOTE: 8, DONE: 9 };
const QUEUE_STALE_MS = 90 * 60 * 1000; // '처리 중'으로 90분 넘게 멈춰 있으면 다시 가져갈 수 있게 합니다

function queueSheet_() {
  return ensureSheet_(book_(), 'queue', ['ID', '요청 시각', '상태', '게시물 주소', '제목', '파일 주소', '바이트', '메모', '처리 시각']);
}

function queueRows_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 9).getValues() : [];
}

function queueCount_() {
  const sh = book_().getSheetByName('queue');
  if (!sh) return 0;
  return queueRows_(sh).filter(r => r[Q.STATE - 1] === '대기' || r[Q.STATE - 1] === '처리 중').length;
}

function queueAdd_(ip, body) {
  const url = String(body.url || '');
  if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url)) throw new Error('YouTube 영상 주소가 아니에요.');
  const before = stats_(ip);
  if (before.myCount >= CONFIG.PER_IP_DAILY) throw new Error('오늘 받을 수 있는 횟수(' + CONFIG.PER_IP_DAILY + '회)를 모두 썼어요.');

  const sh = queueSheet_();
  const dup = queueRows_(sh).find(r => r[Q.URL - 1] === url && (r[Q.STATE - 1] === '대기' || r[Q.STATE - 1] === '처리 중'));
  if (dup) return { ok: true, mode: 'queued', id: dup[Q.ID - 1], duplicate: true, stats: stats_(ip) };

  const id = Utilities.getUuid().slice(0, 8);
  sh.appendRow([id, new Date(), '대기', url, String(body.title || '').slice(0, 200), '', '', '', '']);
  return { ok: true, mode: 'queued', id: id, stats: stats_(ip) };
}

function queueTake_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = queueSheet_();
    const rows = queueRows_(sh);
    const now = Date.now();
    const jobs = [];
    rows.forEach((r, i) => {
      if (jobs.length >= 3) return;
      const state = r[Q.STATE - 1];
      const since = r[Q.DONE - 1] instanceof Date ? r[Q.DONE - 1].getTime() : 0;
      if (state === '대기' || (state === '처리 중' && now - since > QUEUE_STALE_MS)) {
        sh.getRange(i + 2, Q.STATE).setValue('처리 중');
        sh.getRange(i + 2, Q.DONE).setValue(new Date());
        jobs.push({ id: r[Q.ID - 1], url: r[Q.URL - 1], title: r[Q.TITLE - 1] });
      }
    });
    SpreadsheetApp.flush();
    return jobs;
  } finally {
    lock.releaseLock();
  }
}

function queueFind_(sh, id) {
  const rows = queueRows_(sh);
  const i = rows.findIndex(r => r[Q.ID - 1] === id);
  if (i < 0) throw new Error('대기열에서 작업(' + id + ')을 찾지 못했어요.');
  return { row: i + 2, values: rows[i] };
}

/** PC 도우미가 파일을 드라이브에 직접 올릴 수 있도록 업로드 주소(이어 올리기 세션)를 만들어 줍니다. 토큰은 넘기지 않습니다. */
function uploadSession_(body) {
  const sh = queueSheet_();
  queueFind_(sh, String(body.id || ''));
  const size = Number(body.size);
  if (!(size > 0)) throw new Error('파일 크기가 올바르지 않아요.');
  const mime = String(body.mime || 'video/mp4');
  const name = String(body.name || 'youtube.mp4').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
  const session = startResumable_(ScriptApp.getOAuthToken(), name, mime, size, driveFolder_().getId());
  return { ok: true, session: session };
}

function queueDone_(ip, body) {
  const sh = queueSheet_();
  const job = queueFind_(sh, String(body.id || ''));
  const r = job.row;
  if (body.ok) {
    const fileUrl = body.fileId ? 'https://drive.google.com/file/d/' + body.fileId + '/view' : '';
    const bytes = Number(body.bytes) || 0;
    sh.getRange(r, Q.STATE, 1, 1).setValue('완료');
    sh.getRange(r, Q.FILE, 1, 4).setValues([[fileUrl, bytes, String(body.name || ''), new Date()]]);
    record_(ip, 'youtube', 'video', bytes, 'pc', job.values[Q.URL - 1]);
  } else {
    sh.getRange(r, Q.STATE, 1, 1).setValue('실패');
    sh.getRange(r, Q.NOTE, 1, 2).setValues([[String(body.message || '').slice(0, 500), new Date()]]);
  }
  return { ok: true };
}

function record_(ip, platform, type, bytes, mode, sourceUrl) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_('counters');
    const d = today_();
    bumpCounter_(sh, d + '|ip|' + ip, d, 'ip', ip, bytes);
    bumpCounter_(sh, d + '|total', d, 'total', '', bytes);
    sheet_('logs').appendRow([new Date(), ip, platform, type, bytes, mode, sourceUrl]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return stats_(ip);
}

function readCounter_(sh, key) {
  const row = findRow_(sh, key);
  if (!row) return { count: 0, bytes: 0 };
  const v = sh.getRange(row, 5, 1, 2).getValues()[0];
  return { count: Number(v[0]) || 0, bytes: Number(v[1]) || 0 };
}

function bumpCounter_(sh, key, date, kind, ip, bytes) {
  const row = findRow_(sh, key);
  if (!row) { sh.appendRow([key, date, kind, ip, 1, bytes]); return; }
  const r = sh.getRange(row, 5, 1, 2);
  const v = r.getValues()[0];
  r.setValues([[(Number(v[0]) || 0) + 1, (Number(v[1]) || 0) + bytes]]);
}

function findRow_(sh, key) {
  const cell = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

/* ───────────────────────── 도우미 ───────────────────────── */

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
  });
  if (res.getResponseCode() >= 400) throw new Error('게시물을 열지 못했어요 (HTTP ' + res.getResponseCode() + '). 비공개이거나 삭제된 게시물일 수 있어요.');
  return res.getContentText();
}

function parseMeta_(html) {
  const meta = {};
  matchAll_(html, /<meta\s+[^>]*>/gi).forEach(m => {
    const tag = m[0];
    const k = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const v = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (k && v && !(k[1] in meta)) meta[k[1]] = decodeEntities_(v[1]);
  });
  const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (t) meta.title = decodeEntities_(t[1]);
  return meta;
}

function matchAll_(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function unescapeUrl_(s) {
  if (!s) return '';
  try { s = JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (e) { s = s.replace(/\\\//g, '/').replace(/\\u0026/g, '&'); }
  return decodeEntities_(s);
}

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function hostOf_(url) {
  const m = /^https?:\/\/([^\/?#:]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

function isMediaHost_(host) {
  return MEDIA_HOSTS.some(re => re.test(host));
}

function fileName_(platform, mime, type) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4' }[String(mime).split(';')[0]]
    || (type === 'video' ? 'mp4' : 'jpg');
  return (platform || 'media') + '_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') + '.' + ext;
}

function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function sheet_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" 시트가 없어요. Apps Script에서 setup 함수를 먼저 실행해 주세요.');
  return sh;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}
