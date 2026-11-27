(() => {
  'use strict';

  const API = (window.APP_CONFIG || {}).API_URL || '';
  const KEY_NAME = 'linkSaver.apiKey';
  const PLATFORM_NAME = { youtube: 'YouTube', instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook' };
  const SUPPORTED = /^https?:\/\/([^/?#]+\.)?(youtube\.com|youtu\.be|instagram\.com|threads\.net|threads\.com|facebook\.com|fb\.watch)([/?#]|$)/i;
  const GRAD = {
    video: 'linear-gradient(140deg,#3b63f6,#38bdf8)',
    image: 'linear-gradient(140deg,#f59e0b,#ff8fab)',
  };
  const $ = (id) => document.getElementById(id);
  const apiReady = () => API && !API.includes('여기에_배포_ID');

  let current = null;     // 마지막 분석 결과
  let controller = null;  // 진행 중 요청 (취소용)

  /* ── 화면 부품 (Lucian 요소) ── */
  const toast = LUI.toaster($('toasts'));
  const urlField = LUI.floatField($('url-f'), {
    validate: (v) => SUPPORTED.test(v) ? '' : 'YouTube, Instagram, Threads, Facebook 링크를 넣어 주세요.',
  });
  const keyField = LUI.floatField($('key-f'), {
    validate: (v) => v.length >= 16 ? '' : '키가 너무 짧습니다. 로그에 나온 키 전체를 넣어 주세요.',
  });
  const analyzeBtn = LUI.morphButton(document.querySelector('.u438'));
  const picker = LUI.select($('picker'), updateLabels);
  const dlBtn = LUI.progressButton($('dl'), {
    runText: '받는 중', expectSec: 8,
    onStart: () => save(false), onCancel: cancel,
  });
  const gdBtn = LUI.progressButton($('gd'), {
    runText: '드라이브에 올리는 중', expectSec: 45,
    onStart: () => save(true), onCancel: cancel,
  });

  /* ── 비밀 키 ── */
  const storage = {
    get() { try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem(KEY_NAME, v); } catch (e) { /* 저장할 수 없는 환경 */ } },
  };
  let apiKey = storage.get();

  function askKey() {
    return new Promise((resolve) => {
      const dlg = $('key-dialog');
      keyField.setValue(apiKey);
      keyField.clearError();
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        if (dlg.returnValue === 'ok' && keyField.input.value.trim()) {
          apiKey = keyField.input.value.trim();
          storage.set(apiKey);
        }
        resolve(apiKey);
      });
      dlg.showModal();
      keyField.input.focus();
    });
  }
  // 저장 버튼은 키 형식이 맞을 때만 창을 닫습니다
  $('key-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'ok' && !keyField.check()) e.preventDefault();
  });

  /* ── API ── */
  async function api(action, data, signal) {
    if (!apiReady()) throw new Error('config.js에 GAS 웹 앱 주소를 넣어 주세요.');
    if (!apiKey && !(await askKey())) throw new Error('비밀 키를 입력해야 사용할 수 있습니다.');

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 사전 요청(preflight) 없이 GAS로 보내려고 text/plain을 씁니다
      body: JSON.stringify(Object.assign({ action, key: apiKey }, data || {})),
      signal,
    });
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다. 웹 앱 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
    if (json.auth === false) {
      apiKey = '';
      storage.set('');
      throw new Error('비밀 키가 맞지 않습니다. 다시 입력해 주세요.');
    }
    if (json.stats) renderStats(json.stats);
    if (!json.ok) throw new Error(json.error || '요청에 실패했습니다.');
    return json;
  }

  /* ── 화면 그리기 ── */
  function formatBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function renderStats(s) {
    $('s-count').textContent = s.myCount + '회';
    $('s-bytes').textContent = formatBytes(s.totalBytes);
    $('s-queue').textContent = (s.queued || 0) + '개';
  }

  function setStatus(msg, isError) {
    $('status').textContent = msg || '';
    $('status').classList.toggle('err', !!isError);
  }

  function showLink(href, text) {
    const a = $('direct');
    a.href = href;
    a.textContent = text;
    a.hidden = false;
  }

  function renderResult(r) {
    current = r;
    $('result').hidden = false;
    const thumb = $('thumb');
    thumb.hidden = !r.thumbnail;
    thumb.onerror = () => { thumb.hidden = true; };
    thumb.src = r.thumbnail || '';
    $('title').textContent = r.title || '제목 없음';
    $('meta').textContent = [PLATFORM_NAME[r.platform] || r.platform, r.author].filter(Boolean).join(' · ');
    $('note').textContent = r.note || '';
    $('note').hidden = !r.note;

    picker.setOptions(r.items.map((it) => {
      const parts = it.label.split(' · ');
      return {
        code: it.type === 'video' ? 'MP4' : 'JPG',
        title: parts[0],
        sub: parts.slice(1).filter((p) => p !== 'MP4').join(' · ') || (it.type === 'video' ? '원본 영상' : '원본 사진'),
        grad: GRAD[it.type] || GRAD.image,
      };
    }), 0);
    const videos = r.items.filter((i) => i.type === 'video').length;
    const images = r.items.length - videos;
    $('count').textContent = '· ' + [videos && '영상 ' + videos + '개', images && '사진 ' + images + '장'].filter(Boolean).join(' · ');

    setStatus('');
    $('direct').hidden = true;
    dlBtn.reset();
    gdBtn.reset();
    updateLabels();
  }

  function updateLabels() {
    const it = current && current.items[picker.value()];
    const word = it && it.type === 'video' ? '영상' : '사진';
    const queued = !!(it && it.queue);
    document.querySelector('#dl .u004-idle small').textContent = queued ? '드라이브만 가능' : word + ' 다운로드';
    document.querySelector('#gd .u004-idle small').textContent = queued ? 'PC 도우미로 저장' : word + ' 바로 저장';
    dlBtn.setDisabled(queued);
  }

  function saveBase64(b64, mime, filename) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ── 동작 ── */
  async function analyze(e) {
    e.preventDefault();
    if (!analyzeBtn.isIdle()) return;
    if (!urlField.check()) { urlField.input.focus(); return; }
    const url = urlField.input.value.trim();

    analyzeBtn.busy('분석하는 중');
    try {
      const r = await api('analyze', { url });
      analyzeBtn.ok('분석 완료');
      renderResult(r.result);
    } catch (err) {
      analyzeBtn.fail();
      toast.show(err.message, { type: 'err' });
    }
  }

  async function save(toDrive) {
    const item = current && current.items[picker.value()];
    if (!item) return;
    const btn = toDrive ? gdBtn : dlBtn;
    const other = toDrive ? dlBtn : gdBtn;

    // YouTube 영상: 내 PC 도우미의 대기열에 넣습니다
    if (item.queue) {
      if (!toDrive) {
        btn.fail();
        toast.show('YouTube 영상은 "드라이브로"를 눌러 주세요. PC 도우미가 받아서 드라이브에 올립니다.', { type: 'err' });
        return;
      }
      try {
        const r = await api('queue', { url: item.url, title: current.title });
        btn.finish('대기열에 추가됨');
        setStatus(r.duplicate
          ? '이미 대기열에 있는 영상입니다. PC 도우미가 처리하면 드라이브 폴더에 올라옵니다.'
          : '대기열에 넣었습니다. PC가 켜져 있으면 몇 분 안에 드라이브 폴더에 올라옵니다.');
        toast.show('PC 도우미 대기열에 추가했습니다');
      } catch (err) {
        btn.fail();
        setStatus(err.message, true);
        toast.show(err.message, { type: 'err' });
      }
      return;
    }

    controller = new AbortController();
    other.setDisabled(true);
    $('direct').hidden = true;
    setStatus(toDrive
      ? '구글 드라이브에 올리는 중입니다. 큰 영상은 몇 분 걸릴 수 있습니다.'
      : 'GAS가 파일을 가져오는 중입니다.');

    try {
      const r = await api(toDrive ? 'drive' : 'download', {
        mediaUrl: item.url, platform: current.platform, type: item.type, sourceUrl: current.sourceUrl,
      }, controller.signal);

      if (r.mode === 'drive') {
        btn.finish('드라이브에 저장됨');
        showLink(r.url, '드라이브에서 열기 ↗');
        setStatus(r.name + ' (' + formatBytes(r.bytes) + ')를 드라이브에 저장했습니다.');
        toast.show('드라이브에 저장했습니다 · ' + formatBytes(r.bytes), {
          action: { label: '열기', onClick: () => window.open(r.url, '_blank', 'noopener') },
        });
      } else if (r.mode === 'proxy') {
        saveBase64(r.base64, r.mime, r.filename);
        btn.finish('저장됨');
        setStatus('저장이 끝났습니다 (' + formatBytes(r.bytes) + '). 브라우저 다운로드 목록을 확인해 주세요.');
        toast.show('다운로드했습니다 · ' + formatBytes(r.bytes));
      } else {
        btn.finish('원본 링크 준비됨');
        showLink(r.url, '새 탭에서 원본 열기 ↗');
        setStatus('파일이 커서 원본 링크로 엽니다. 새 탭에서 우클릭 → "다른 이름으로 저장"을 눌러 주세요. 큰 영상은 드라이브 저장이 편합니다.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatus(toDrive
          ? '기다리기를 멈췄습니다. 드라이브 업로드는 서버에서 계속될 수 있으니 잠시 뒤 폴더를 확인해 주세요.'
          : '취소했습니다.');
      } else {
        btn.fail();
        setStatus(err.message, true);
        toast.show(err.message, { type: 'err' });
      }
    } finally {
      other.setDisabled(false);
      controller = null;
    }
  }

  function cancel() {
    if (controller) controller.abort();
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) urlField.setValue(text.trim());
    } catch (e) {
      urlField.input.focus();
      toast.show('붙여넣기 권한이 없습니다. 주소 칸에 직접 붙여넣어 주세요 (Ctrl+V).', { type: 'err' });
    }
  }

  async function loadStats() {
    if (!apiKey || !apiReady()) return;
    try { await api('stats'); } catch (e) { /* 첫 화면에서는 조용히 넘어갑니다 */ }
  }

  $('form').addEventListener('submit', analyze);
  $('paste').addEventListener('click', paste);
  $('change-key').addEventListener('click', async () => { await askKey(); loadStats(); });

  if (!apiReady()) toast.show('config.js에 GAS 웹 앱 주소를 넣어야 동작합니다.', { type: 'err', life: 9000 });
  loadStats();
})();
