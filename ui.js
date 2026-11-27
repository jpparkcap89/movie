/*
 * Lucian UX/UI Prompt 요소 스크립트를 실제 동작(API 호출)에 연결할 수 있도록 함수로 감쌌습니다.
 * 각 요소의 상태 전환·키보드·접근성 동작은 원본을 그대로 유지합니다.
 * Lucian UX/UI Prompt · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/
 */
window.LUI = (function () {
  'use strict';
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var uidOf = function (p) { return p + '-' + Math.random().toString(36).slice(2, 7); };

  /* ── Lucian UX/UI Prompt #025 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#025
     테두리로 떠오르는 라벨 입력. 조정: 이메일 검사 대신 opts.validate(값) → 오류 문구('' 이면 통과) */
  function floatField(f, opts) {
    opts = opts || {};
    var input = f.querySelector('.u025-in');
    var lab = f.querySelector('.u025-lab');
    var line = f.querySelector('.u025-line');
    var msg = f.querySelector('.u025-msg');
    if (!input.id) input.id = uidOf('u025');
    lab.htmlFor = input.id;
    if (msg) { msg.id = input.id + '-m'; input.setAttribute('aria-describedby', msg.id); }

    // 라벨이 올라가면, 줄어든 라벨 폭만큼 위쪽 테두리에 틈을 냅니다
    function lift() {
      var up = document.activeElement === input || input.value.length > 0;
      f.classList.toggle('is-up', up);
      line.style.setProperty('--gap', up ? (lab.offsetWidth * 0.8 + 2) + 'px' : '0px');
    }
    function showError(text) {
      f.classList.remove('is-ok');
      f.classList.add('is-bad');
      input.setAttribute('aria-invalid', 'true');
      if (msg) msg.textContent = text;
      f.classList.remove('is-shake'); void f.offsetWidth; f.classList.add('is-shake');
    }
    function clearError() {
      f.classList.remove('is-bad');
      input.removeAttribute('aria-invalid');
      if (msg) msg.textContent = '';
    }
    function check(strict) {
      var v = input.value.trim();
      if (!opts.validate) return !!v;
      var err = v ? opts.validate(v) : '';
      var ok = !!v && !err;
      f.classList.toggle('is-ok', ok);
      if (ok || !v) clearError();
      else if (strict) showError(err);
      return ok;
    }
    input.addEventListener('focus', function () { f.classList.add('is-focus'); lift(); });
    input.addEventListener('blur', function () { f.classList.remove('is-focus'); lift(); check(true); });
    input.addEventListener('input', function () { lift(); check(f.classList.contains('is-bad')); });
    lift();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(lift);
    return {
      input: input,
      check: function () { return check(true); },
      setValue: function (v) { input.value = v; lift(); check(true); },
      showError: showError,
      clearError: clearError,
    };
  }

  /* ── Lucian UX/UI Prompt #438 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#438
     로딩→완료 버튼. 조정: 정해진 시간 대신 busy() / ok() / fail()을 실제 요청 결과에 맞춰 부릅니다 */
  function morphButton(root) {
    var b = root.querySelector('.u438-b'), lbl = root.querySelector('.u438-l'), live = root.querySelector('.u438-live');
    var full = 0, t2 = 0, t3 = 0;
    function measure() {
      if (b.dataset.s !== 'idle') return;
      b.style.setProperty('--w', 'auto');
      var w = lbl.getBoundingClientRect().width / (root.getBoundingClientRect().width / root.offsetWidth || 1);
      if (!w) { full = 0; return; }
      full = Math.ceil(w);
      b.style.setProperty('--w', full + 'px');
    }
    function set(s) {
      b.dataset.s = s;
      if (s === 'busy') { b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-disabled', 'true'); }
      else b.removeAttribute('aria-busy');
      if (s === 'idle') b.removeAttribute('aria-disabled');
    }
    function grow() {
      b.classList.add('is-grow');
      set('idle');
      b.style.setProperty('--w', full + 'px');
      clearTimeout(t3);
      t3 = setTimeout(function () { b.classList.remove('is-grow'); }, rm ? 0 : 700);
    }
    b.addEventListener('pointerdown', function (e) { if (e.button === 0 && b.dataset.s === 'idle') b.classList.add('is-down'); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, function () { b.classList.remove('is-down'); }); });
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return {
      isIdle: function () { return b.dataset.s === 'idle'; },
      busy: function (text) {
        if (!full) measure();
        clearTimeout(t2); clearTimeout(t3);
        b.classList.remove('is-down', 'is-grow');
        set('busy');
        b.style.setProperty('--w', '48px');
        live.textContent = text || '';
      },
      ok: function (text) {
        set('ok');
        live.textContent = text || '';
        t2 = setTimeout(grow, rm ? 600 : 1000);
      },
      fail: function () { grow(); live.textContent = ''; },
    };
  }

  /* ── Lucian UX/UI Prompt #031 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#031
     맞춤 선택 목록. 조정: 고정 언어 목록 대신 setOptions(분석 결과)로 채우고, 고르면 onChange(i)를 부릅니다 */
  function select(root, onChange) {
    var btn = root.querySelector('.u031-btn');
    var list = root.querySelector('.u031-list');
    var hl = root.querySelector('.u031-hl');
    var uid = uidOf('u031');
    var OPTS = [], items = [], sel = 0, act = 0, typed = '', tt = 0;
    list.id = uid;
    btn.setAttribute('aria-controls', uid);

    function mark() {
      if (!items[act]) return;
      hl.style.setProperty('--i', act);
      list.setAttribute('aria-activedescendant', items[act].id);
      items[act].scrollIntoView({ block: 'nearest' });
    }
    function paint(i, animate) {
      var o = OPTS[i];
      if (!o) return;
      var flag = btn.querySelector('.u031-flag');
      flag.textContent = o.code;
      flag.style.setProperty('--c', o.grad);
      btn.querySelector('.u031-v b').textContent = o.title;
      btn.querySelector('.u031-v small').textContent = o.sub || '';
      var v = btn.querySelector('.u031-v');
      // 바뀐 값이 살짝 튀어 오르며 들어옵니다
      if (animate && v.animate) v.animate([{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.34,1.45,.64,1)' });
    }
    function open() {
      if (!items.length) return;
      root.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      list.classList.add('is-open');
      act = sel; mark();
      list.focus({ preventScroll: true });
    }
    function close(refocus) {
      root.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      list.classList.remove('is-open');
      if (refocus) btn.focus({ preventScroll: true });
    }
    function choose(i) {
      sel = i;
      items.forEach(function (li, k) { li.setAttribute('aria-selected', String(k === i)); });
      paint(i, true);
      close(true);
      if (onChange) onChange(i);
    }
    function setOptions(opts, start) {
      items.forEach(function (li) { li.remove(); });
      OPTS = opts;
      sel = act = start || 0;
      items = OPTS.map(function (o, i) {
        var li = document.createElement('li');
        li.className = 'u031-o';
        li.id = uid + '-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === sel));
        var flag = document.createElement('span');
        flag.className = 'u031-flag';
        flag.setAttribute('aria-hidden', 'true');
        flag.style.setProperty('--c', o.grad);
        flag.textContent = o.code;
        var small = document.createElement('small');
        small.textContent = o.sub || '';
        li.appendChild(flag);
        li.appendChild(document.createTextNode(o.title));
        li.appendChild(small);
        li.insertAdjacentHTML('beforeend', '<svg class="u031-ck" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.5l3.5 3.5L14 6"/></svg>');
        li.addEventListener('pointermove', function () { if (act !== i) { act = i; mark(); } });
        li.addEventListener('click', function () { choose(i); });
        list.appendChild(li);
        return li;
      });
      hl.style.setProperty('--i', sel);
      paint(sel, false);
    }

    btn.addEventListener('click', function () { list.classList.contains('is-open') ? close(true) : open(); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    list.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(items.length - 1, act + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); mark(); }
      else if (e.key === 'Home') { e.preventDefault(); act = 0; mark(); }
      else if (e.key === 'End') { e.preventDefault(); act = items.length - 1; mark(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(act); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
      else if (e.key.length === 1) {
        // 글자를 치면 그 글자로 시작하는 항목으로 갑니다
        typed += e.key.toLowerCase();
        clearTimeout(tt); tt = setTimeout(function () { typed = ''; }, 600);
        var hit = OPTS.findIndex(function (o) { return o.title.toLowerCase().indexOf(typed) === 0 || o.code.toLowerCase().indexOf(typed) === 0; });
        if (hit >= 0) { act = hit; mark(); }
      }
    });
    list.addEventListener('blur', function () { setTimeout(function () { if (!root.contains(document.activeElement)) close(false); }, 0); });
    document.addEventListener('pointerdown', function (e) { if (list.classList.contains('is-open') && !root.querySelector('.u031-f').contains(e.target)) close(false); });

    return { setOptions: setOptions, value: function () { return sel; } };
  }

  /* ── Lucian UX/UI Prompt #004 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#004
     진행률 다운로드 버튼. 조정: GAS 응답은 한 번에 오기 때문에 진짜 진행률을 알 수 없습니다.
     막대는 기다리는 동안 90%까지 천천히 차오르고(퍼센트 숫자 대신 경과 시간 표시), 응답이 오면 100%로 끝냅니다.
     받는 중에 다시 누르면 opts.onCancel()로 취소합니다 */
  function progressButton(root, opts) {
    var btn = root.querySelector('.u004-btn');
    var runLabel = root.querySelector('.u004-pct');
    var eta = root.querySelector('.u004-eta');
    var okText = root.querySelector('.u004-ok span');
    var live = root.querySelector('.u004-live');
    var raf = 0, timers = [], t0 = 0, tau = (opts.expectSec || 8) * 1000;
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function clear() { timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf); raf = 0; }
    function set(v) { btn.style.setProperty('--p', v.toFixed(4)); }
    function step(now) {
      var el = now - t0;
      set(0.9 * (1 - Math.exp(-el / tau)));
      eta.textContent = Math.floor(el / 1000) + '초째';
      raf = requestAnimationFrame(step);
    }
    function reset() { clear(); root.dataset.state = 'idle'; set(0); live.textContent = ''; }
    function start() {
      clear();
      set(0);
      root.dataset.state = 'run';
      runLabel.textContent = opts.runText || '받는 중';
      eta.textContent = '0초째';
      live.textContent = opts.runText || '받는 중';
      later(function () { t0 = performance.now(); raf = requestAnimationFrame(step); }, rm ? 0 : 260);
    }
    btn.addEventListener('click', function () {
      var s = root.dataset.state;
      if (s === 'run') { // 받는 중에 누르면 취소하고 처음으로 돌아갑니다
        reset();
        live.textContent = '취소했어요';
        if (opts.onCancel) opts.onCancel();
        return;
      }
      if (s !== 'idle') { reset(); return; }
      start();
      if (opts.onStart) opts.onStart();
    });
    return {
      finish: function (text) {
        clear();
        set(1);
        okText.textContent = text || '저장됨';
        later(function () {
          root.dataset.state = 'fold';
          live.textContent = text || '저장됨';
          later(function () { root.dataset.state = 'done'; }, rm ? 100 : 650);
          later(reset, rm ? 1600 : 3400);
        }, rm ? 0 : 280);
      },
      fail: reset,
      reset: reset,
      isRunning: function () { return root.dataset.state === 'run'; },
      setDisabled: function (v) { btn.disabled = !!v; },
    };
  }

  /* ── Lucian UX/UI Prompt #435 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#435
     토스트 알림. 조정: show(문구, { type:'ok'|'err', action:{label, onClick}, life })로 띄우고,
     '실행 취소' 자리는 동작 버튼(예: 드라이브에서 열기)으로 씁니다. 쌓기·펼치기·밀어서 닫기는 원본 그대로 */
  function toaster(root) {
    var rg = root.querySelector('.u435-rg');
    var H = 56, GAP = 8, MAX = 3;
    var toasts = [], open = false, paused = false;

    function layout() {
      var live = toasts.filter(function (t) { return !t.gone; }), n = live.length;
      live.forEach(function (t, k) {
        var i = n - 1 - k;
        var y = open ? -i * (H + GAP) : -i * 11, s = open ? 1 : 1 - i * 0.055;
        t.el.style.setProperty('--y', y + 'px');
        t.el.style.setProperty('--s', s.toFixed(3));
        t.el.style.setProperty('--o', i < MAX ? 1 : 0);
        t.el.style.zIndex = String(20 - i);
        t.el.classList.toggle('is-back', !open && i > 0);
      });
      rg.style.height = (open && n > 1 ? n * H + (n - 1) * GAP : H + 20) + 'px';
    }
    function timer(t) {
      clearTimeout(t.tm);
      t.t0 = Date.now();
      if (!paused) t.tm = setTimeout(function () { dismiss(t); }, t.left);
    }
    function bar(t, ms) {
      t.el.querySelector('.u435-pb').innerHTML = '<i style="animation-duration:' + ms + 'ms"></i>';
      t.left = ms;
      timer(t);
    }
    function show(text, o) {
      o = o || {};
      var err = o.type === 'err';
      var el = document.createElement('div');
      el.className = 'u435-t' + (err ? ' is-err' : '');
      el.setAttribute('role', err ? 'alert' : 'status');
      el.title = text;
      var icon = err ? '<path d="M12 6.5v7M12 17.3v.2"/>' : '<path d="m6 12.5 4 4 8-9"/>';
      el.innerHTML = '<span class="u435-ic" aria-hidden="true"><span class="ok"><svg viewBox="0 0 24 24">' + icon + '</svg></span></span>' +
        '<span class="u435-tx"><b></b></span><button type="button" class="u435-un" hidden></button><button type="button" class="u435-x" aria-label="알림 닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><span class="u435-pb" aria-hidden="true"></span>';
      el.querySelector('.u435-tx b').textContent = text;
      var t = { el: el };
      if (o.action) {
        var a = el.querySelector('.u435-un');
        a.hidden = false;
        a.textContent = o.action.label;
        a.addEventListener('click', function () { o.action.onClick(); dismiss(t); });
      }
      el.querySelector('.u435-x').addEventListener('click', function () { dismiss(t); });
      swipe(t);
      toasts.push(t);
      if (!rm) {
        el.classList.add('is-in');
        el.style.setProperty('--y', '84px'); el.style.setProperty('--s', '.9'); el.style.setProperty('--o', '0');
        el.style.transition = 'none';
        rg.appendChild(el);
        void el.offsetWidth;
        el.style.transition = '';
      } else rg.appendChild(el);
      bar(t, o.life || (err ? 8000 : 5000));
      var live = toasts.filter(function (x) { return !x.gone; });
      if (live.length > MAX) dismiss(live[0], 0, true);
      layout();
      return t;
    }
    // 닫기: 옆으로 밀었으면 그 속도 그대로 날아가고, 아니면 살짝 가라앉으며 흐려집니다
    function dismiss(t, dir, quiet) {
      if (t.gone) return;
      t.gone = true;
      clearTimeout(t.tm);
      var el = t.el;
      if (el.contains(document.activeElement)) {
        var other = toasts.filter(function (x) { return !x.gone; }).pop();
        if (other) other.el.querySelector('.u435-x').focus({ preventScroll: true });
        else document.activeElement.blur();
      }
      el.style.pointerEvents = 'none';
      var done = function () { el.remove(); var i = toasts.indexOf(t); if (i >= 0) toasts.splice(i, 1); };
      layout();
      if (rm || !el.animate) { done(); return; }
      var y = el.style.getPropertyValue('--y') || '0px', s = el.style.getPropertyValue('--s') || '1';
      if (dir) {
        var v = Math.max(1.2, Math.abs(t.v || 0)), dist = 380, dur = Math.max(160, Math.min(320, dist / v));
        el.classList.add('is-drag');
        el.animate([{ transform: 'translate3d(' + (t.dx || 0) + 'px,' + y + ',0) scale(' + s + ')', opacity: 1 }, { transform: 'translate3d(' + dir * dist + 'px,' + y + ',0) scale(' + s + ') rotate(' + dir * 6 + 'deg)', opacity: 0 }], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = done;
      } else {
        el.animate([{ opacity: quiet ? 0 : 1 }, { transform: 'translate3d(0,calc(' + y + ' + 14px),0) scale(' + (s * 0.94) + ')', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = done;
      }
    }
    // 밀어서 닫기: 마지막 움직임의 속도를 재서, 충분히 빠르거나 멀리 밀었으면 날려 보냅니다
    function swipe(t) {
      var el = t.el, on = false, x0 = 0, last = [];
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || e.target.closest('button') || t.gone) return;
        on = true; x0 = e.clientX; t.dx = 0; t.v = 0; last = [[e.clientX, e.timeStamp]];
        el.classList.add('is-drag');
        try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      });
      el.addEventListener('pointermove', function (e) {
        if (!on) return;
        t.dx = e.clientX - x0;
        last.push([e.clientX, e.timeStamp]);
        if (last.length > 5) last.shift();
        el.style.setProperty('--x', t.dx.toFixed(1) + 'px');
        el.style.opacity = String(Math.max(0.35, 1 - Math.abs(t.dx) / 320));
      });
      var end = function () {
        if (!on) return;
        on = false;
        var a = last[0], b = last[last.length - 1];
        t.v = b && a && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
        el.style.opacity = '';
        if (Math.abs(t.dx) > 80 || Math.abs(t.v) > 0.6) { dismiss(t, (Math.abs(t.v) > 0.6 ? t.v : t.dx) > 0 ? 1 : -1); return; }
        el.classList.remove('is-drag');
        el.style.setProperty('--x', '0px');
        t.dx = 0;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    // 커서를 올리거나 초점이 들어오면 펼치고 시간을 멈춥니다
    function setOpen(v) {
      if (open === v) return;
      open = v;
      paused = v;
      rg.classList.toggle('is-paused', v);
      toasts.forEach(function (t) {
        if (t.gone) return;
        if (v) { clearTimeout(t.tm); t.left = Math.max(500, t.left - (Date.now() - t.t0)); } else timer(t);
      });
      layout();
    }
    var leaveT = 0;
    rg.addEventListener('pointerenter', function () { clearTimeout(leaveT); setOpen(true); });
    rg.addEventListener('pointerleave', function () { clearTimeout(leaveT); leaveT = setTimeout(function () { if (!rg.contains(document.activeElement)) setOpen(false); }, 120); });
    rg.addEventListener('focusin', function () { setOpen(true); });
    rg.addEventListener('focusout', function (e) { if (!rg.contains(e.relatedTarget)) setOpen(false); });
    rg.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var el = e.target.closest('.u435-t'), t = toasts.filter(function (x) { return x.el === el; })[0];
      if (t && !t.gone) { e.preventDefault(); e.stopPropagation(); dismiss(t); }
    });
    return { show: show };
  }

  return { floatField: floatField, morphButton: morphButton, select: select, progressButton: progressButton, toaster: toaster };
})();
