/* 小丁钢琴课 —— 前端逻辑
 * 云服务：数据库 + 邮箱登录（老师端）
 * 家长端不注册账号，输入登记过的手机号后走 SECURITY DEFINER 函数读写，全程不接触数据表
 */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG;
  var cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    publishableKey: cfg.publishableKey,
  });
  var db = cloud.database;

  // ---------------------------------------------------------------- 基础工具
  function $(id) { return document.getElementById(id); }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  // 微信内置浏览器对未备案域名会劝退，直接告诉家长怎么切到浏览器
  (function wechatHint() {
    if (!/MicroMessenger/i.test(navigator.userAgent)) return;
    var off = false;
    try { off = sessionStorage.getItem('wx_tip_off') === '1'; } catch (e) {}
    if (off) return;
    var tip = $('wx-tip');
    if (!tip) return;
    show(tip);
    tip.addEventListener('click', function () {
      hide(tip);
      try { sessionStorage.setItem('wx_tip_off', '1'); } catch (e) {}
    });
  })();

  function ls(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key) || '';
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(val));
    } catch (e) { /* 隐私模式下忽略 */ }
    return '';
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, isErr ? 3600 : 2200);
  }

  var modalResolve = null;
  var modalMode = 'confirm';

  function ask(opts) {
    opts = opts || {};
    modalMode = opts.input ? 'input' : 'confirm';
    $('modal-title').textContent = opts.title || '确认';
    $('modal-text').textContent = opts.text || '';
    var input = $('modal-input');
    if (opts.input) {
      input.classList.remove('hidden');
      input.value = opts.inputValue || '';
      input.placeholder = opts.placeholder || '';
    } else {
      input.classList.add('hidden');
      input.value = '';
    }
    $('modal-ok').textContent = opts.okText || '确定';
    $('modal-cancel').textContent = opts.cancelText || '取消';
    $('modal-choices').innerHTML = '';
    hide($('modal-choices'));
    $('modal-form').innerHTML = '';
    hide($('modal-form'));
    show($('modal-ok'));
    show($('modal'));

    return new Promise(function (resolve) {
      modalResolve = resolve;
    });
  }
  $('modal-ok').addEventListener('click', function () {
    if (modalMode === 'form') { finishModal(collectForm()); return; }
    var v = $('modal-input').classList.contains('hidden') ? true : $('modal-input').value;
    finishModal(v);
  });
  $('modal-cancel').addEventListener('click', function () { finishModal(null); });
  $('modal').addEventListener('click', function (e) {
    if (e.target === $('modal')) finishModal(null);
  });
  function finishModal(v) {
    hide($('modal'));
    var r = modalResolve;
    modalResolve = null;
    if (r) r(v);
  }

  // 多选项弹窗（家长点格子后选上多久）
  function askChoice(opts) {
    modalMode = 'choices';
    $('modal-title').textContent = opts.title || '请选择';
    $('modal-text').textContent = opts.text || '';
    $('modal-input').classList.add('hidden');
    $('modal-input').value = '';
    $('modal-form').innerHTML = '';
    hide($('modal-form'));

    var box = $('modal-choices');
    box.innerHTML = (opts.choices || []).map(function (c) {
      return '<button type="button" class="btn btn-ghost btn-block" data-choice="' + c.value + '">' +
        esc(c.label) + '</button>';
    }).join('');
    show(box);
    hide($('modal-ok'));
    $('modal-cancel').textContent = opts.cancelText || '取消';
    show($('modal'));

    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  $('modal-choices').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-choice]');
    if (!btn) return;
    finishModal(Number(btn.getAttribute('data-choice')));
  });

  // 多字段表单弹窗（编辑学员用）
  function askForm(opts) {
    modalMode = 'form';
    $('modal-title').textContent = opts.title || '编辑';
    $('modal-text').textContent = opts.text || '';
    $('modal-input').classList.add('hidden');
    $('modal-input').value = '';
    $('modal-choices').innerHTML = '';
    hide($('modal-choices'));

    var box = $('modal-form');
    box.innerHTML = (opts.fields || []).map(function (f) {
      if (f.type === 'check') {
        return '<label class="check-inline"><input type="checkbox" data-key="' + f.key + '"' +
          (f.value ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>';
      }
      var val = (f.value === null || f.value === undefined) ? '' : f.value;
      return '<label class="form-row"><span>' + esc(f.label) + '</span>' +
        '<input class="input" data-key="' + f.key + '" type="' + (f.type || 'text') + '"' +
        ' value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '"></label>';
    }).join('');
    show(box);

    $('modal-ok').textContent = opts.okText || '保存';
    $('modal-cancel').textContent = opts.cancelText || '取消';
    show($('modal-ok'));
    show($('modal'));

    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  function collectForm() {
    var out = {};
    $('modal-form').querySelectorAll('[data-key]').forEach(function (el) {
      out[el.getAttribute('data-key')] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    return out;
  }

  // ---------------------------------------------------------------- 路由
  var SCREENS = ['home', 'parent', 'teacher'];
  function go(name) {
    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (s === name) show(el); else hide(el);
    });
    window.scrollTo(0, 0);
    if (name === 'parent') parentEnter();
    if (name === 'teacher') teacherEnter();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go]');
    if (el) { go(el.getAttribute('data-go')); }
  });

  // 标签页切换
  document.querySelectorAll('.tabs').forEach(function (nav) {
    nav.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (!tab) return;
      var paneId = tab.getAttribute('data-pane');
      nav.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
      var scope = nav.parentElement;
      scope.querySelectorAll('.pane').forEach(function (p) {
        p.classList.toggle('hidden', p.id !== paneId);
      });
    });
  });

  // ---------------------------------------------------------------- 时间工具
  // 全站时间统一按东八区（北京时间）显示与录入，不看打开设备的时区设置
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var LOCK_HOURS = 12; // 距开课不足这么多小时，家长不能自助取消/请假
  var TZ_MIN = 8 * 60; // 北京时间固定 UTC+8

  function asDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    return new Date(v);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  // 绝对时刻 → 北京时间的年月日时分
  function sh(v) {
    var d = asDate(v);
    if (!d) return null;
    var t = new Date(d.getTime() + TZ_MIN * 60000);
    return {
      y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
      hh: t.getUTCHours(), mi: t.getUTCMinutes(), wd: t.getUTCDay()
    };
  }

  // 北京时间的年月日时分 → 绝对时刻
  function shDate(y, mo, d, hh, mi) {
    return new Date(Date.UTC(y, mo, d, hh || 0, mi || 0) - TZ_MIN * 60000);
  }

  function hhmm(v) {
    var p = sh(v);
    if (!p) return '';
    return pad2(p.hh) + ':' + pad2(p.mi);
  }

  function dayKey(v) {
    var p = sh(v);
    if (!p) return '';
    return p.y + '-' + (p.mo + 1) + '-' + p.d;
  }

  function shToday() {
    var p = sh(new Date());
    return { y: p.y, mo: p.mo, d: p.d };
  }

  function mdh(v) {
    var p = sh(v);
    return (p.mo + 1) + '月' + p.d + '日';
  }
  function shWeek(v) {
    return WEEK[sh(v).wd];
  }

  function dayHead(v) {
    var p = sh(v);
    var t = shToday();
    var diff = Math.round((Date.UTC(p.y, p.mo, p.d) - Date.UTC(t.y, t.mo, t.d)) / 86400000);
    var md = (p.mo + 1) + '月' + p.d + '日';
    var main = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '后天' : md;
    if (diff < 0) main = md;
    return { main: main, sub: WEEK[p.wd] + ' ' + md };
  }

  var STATUS_TEXT = { booked: '已预约', done: '已上课', cancelled: '已取消', leave: '已请假', open: '可约' };
  function statusBadge(s) {
    return '<span class="badge badge-' + s + '">' + (STATUS_TEXT[s] || s) + '</span>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function trimNum(v) { var n = num(v); return Math.round(n * 10) / 10; }

  // 只保留数字，取后 11 位（后端同样会归一化）
  function normPhone(v) {
    var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    return d.length > 11 ? d.slice(-11) : d;
  }
  function maskPhone(v) {
    var s = normPhone(v);
    if (s.length !== 11) return s || '未填';
    return s.slice(0, 3) + '****' + s.slice(7);
  }

  function emptyBox(text) {
    return '<div class="empty">' + esc(text) + '</div>';
  }

  function unwrapJson(v) {
    if (v && typeof v === 'string') {
      try { return JSON.parse(v); } catch (e) { return null; }
    }
    return v;
  }

  // =================================================================
  // 家长端（凭登记过的手机号进入，无需账号）
  // =================================================================
  var parentState = { id: null, name: '', phone: '', kids: [], data: null };

  function parentEnter() {
    var urlPhone = normPhone(new URLSearchParams(location.search).get('phone'));
    var savedId = ls('piano_student_id');
    var savedPhone = ls('piano_phone');

    if (urlPhone) {
      $('phone-input').value = urlPhone;
      if (savedId && savedPhone === urlPhone) {
        setParentLoading(true);
        loadParent(Number(savedId), urlPhone, true);
        return;
      }
      $('phone-input').focus();
      showGate();
      return;
    }

    if (savedId && savedPhone) {
      setParentLoading(true);
      loadParent(Number(savedId), savedPhone, true);
      return;
    }
    showGate();
  }

  function showGate() {
    show($('parent-gate'));
    hide($('parent-picker'));
    hide($('parent-main'));
  }

  function setParentLoading(on) {
    if (on) {
      showGate();
      $('phone-submit').disabled = true;
      $('phone-submit').textContent = '正在进入…';
    } else {
      $('phone-submit').disabled = false;
      $('phone-submit').textContent = '进入';
    }
  }

  function showGateError(msg) {
    var el = $('gate-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    show($('parent-gate'));
    hide($('parent-picker'));
    hide($('parent-main'));
  }

  async function lookupAndEnter(phone) {
    var p = normPhone(phone);
    if (p.length !== 11) { showGateError('请输入 11 位手机号'); return; }
    setParentLoading(true);
    var res;
    try {
      res = await db.rpc('parent_lookup', { p_phone: p });
    } catch (err) {
      setParentLoading(false);
      showGateError('网络不稳，请稍后重试');
      return;
    }
    setParentLoading(false);
    if (res.error) {
      showGateError('加载失败：' + (res.error.message || '请稍后重试'));
      return;
    }
    var data = unwrapJson(res.data);
    if (!data || !data.ok) {
      showGateError((data && data.error) || '这个手机号还没有登记，请联系老师');
      return;
    }
    // 名下多个孩子也不先弹选择：直接进第一个（浏览器会记住上次看的那个），顶部标签随时切
    loadParent(Number(data.students[0].id), p, false);
  }

  function showPicker(list, phone) {
    $('picker-list').innerHTML = list.map(function (s) {
      return '<button class="role-card" data-pick="' + s.id + '">' +
        '<span class="role-title">' + esc(s.name) + '</span>' +
        '<span class="role-desc">点这里进入</span></button>';
    }).join('');
    $('picker-back').setAttribute('data-phone', phone || '');
    hide($('parent-gate'));
    hide($('parent-main'));
    show($('parent-picker'));
  }

  async function loadParent(studentId, phone, silent) {
    if (!studentId) { showGate(); return; }
    var p = normPhone(phone);
    var res;
    try {
      res = await db.rpc('parent_overview', { p_student_id: studentId, p_phone: p });
    } catch (err) {
      setParentLoading(false);
      showGateError('网络不稳，请稍后重试');
      return;
    }
    setParentLoading(false);

    if (res.error) {
      showGateError('加载失败：' + (res.error.message || '请稍后重试'));
      return;
    }
    var data = unwrapJson(res.data);
    if (!data || !data.ok) {
      ls('piano_student_id', null);
      ls('piano_phone', null);
      parentState = { id: null, name: '', phone: '', kids: [], data: null };
      showGateError((data && data.error) || '没找到这个学员，请联系老师');
      return;
    }

    parentState.id = Number(data.student.id);
    parentState.name = data.student.name;
    parentState.phone = p;
    parentState.data = data;
    ls('piano_student_id', parentState.id);
    ls('piano_phone', p);
    refreshKids();

    $('gate-error').classList.add('hidden');
    hide($('parent-gate'));
    hide($('parent-picker'));
    show($('parent-main'));
    renderParent();
  }

  // 同一个手机号下可能登记了多个孩子：名字直接做成标签，点一下就切（不用重输手机号）
  function refreshKids() {
    var box = $('p-kids');
    var nameEl = $('p-student-name');
    if (!parentState.phone) { hide(box); show(nameEl); return; }

    db.rpc('parent_lookup', { p_phone: parentState.phone }).then(function (res) {
      var data = unwrapJson(res && res.data);
      var kids = (data && data.ok && data.students) ? data.students : [];
      parentState.kids = kids;

      if (kids.length > 1) {
        box.innerHTML = kids.map(function (k) {
          var on = String(k.id) === String(parentState.id);
          return '<button type="button" class="kid-tab' + (on ? ' active' : '') +
            '" data-kid="' + k.id + '">' + esc(k.name) + '</button>';
        }).join('');
        show(box);
        hide(nameEl);
      } else {
        hide(box);
        show(nameEl);
      }
    }).catch(function () { hide(box); show(nameEl); });
  }

  $('p-kids').addEventListener('click', function (e) {
    var b = e.target.closest('[data-kid]');
    if (!b) return;
    var id = Number(b.getAttribute('data-kid'));
    if (String(id) === String(parentState.id)) return;
    loadParent(id, parentState.phone, false);
  });

  function renderParent() {
    var d = parentState.data;
    $('p-student-name').textContent = d.student.name;
    $('p-student-sub').textContent = '家长手机号 ' + maskPhone(parentState.phone);
    $('p-remain').textContent = trimNum(d.student.remain);
    $('p-used').textContent = trimNum(d.student.used);
    $('p-total').textContent = trimNum(d.student.total);

    renderNextClass(d.bookings || []);
    renderParentCalendar(d.slots || []);
    renderParentBookings(d.bookings || []);
  }

  // 首屏第二优先级：下一次上课时间
  function renderNextClass(bookings) {
    var now = Date.now();
    var next = bookings.filter(function (b) {
      return b.status === 'booked' && asDate(b.start).getTime() > now;
    }).sort(function (a, b) { return asDate(a.start) - asDate(b.start); })[0];

    var card = $('p-next');
    if (!next) { hide(card); return; }
    var st = asDate(next.start);
    var realEnd = next.dur ? new Date(st.getTime() + next.dur * 60000) : asDate(next.end);
    $('p-next-value').textContent = dayHead(st).main + ' ' + hhmm(st) + ' – ' + hhmm(realEnd);
    show(card);
  }

  var parentCal = { year: null, month: null, pickedKey: null, byDay: {} };

  function renderParentCalendar(slots) {
    if (slots) {
      var byDay = {};
      slots.forEach(function (s) {
        var k = dayKey(asDate(s.start));
        (byDay[k] = byDay[k] || []).push(s);
      });
      parentCal.byDay = byDay;

      var keys = Object.keys(byDay).filter(function (k) {
        return byDay[k].some(function (s) { return !s.taken; });
      }).sort(function (a, b) { return parseDayKey(a) - parseDayKey(b); });

      if (parentCal.year === null) {
        if (keys.length) {
          var first = sh(parseDayKey(keys[0]));
          parentCal.year = first.y;
          parentCal.month = first.mo;
          parentCal.pickedKey = keys[0];
        } else {
          var t0s = shToday();
          parentCal.year = t0s.y;
          parentCal.month = t0s.mo;
          parentCal.pickedKey = null;
        }
      } else if (parentCal.pickedKey && !byDay[parentCal.pickedKey]) {
        // 原来选的那天已经没得约了，自动跳到最近有空的
        parentCal.pickedKey = keys.length ? keys[0] : null;
        if (keys.length) {
          var f2 = sh(parseDayKey(keys[0]));
          parentCal.year = f2.y;
          parentCal.month = f2.mo;
        }
      }
    }

    var countOf = {};
    Object.keys(parentCal.byDay).forEach(function (k) {
      countOf[k] = parentCal.byDay[k].filter(function (s) { return !s.taken; }).length;
    });

    renderCalGrid($('p-cal'), parentCal, {
      mode: 'parent',
      scope: 'parent',
      countOf: countOf,
      picked: parentCal.pickedKey ? [parentCal.pickedKey] : [],
      legend: '<span><i class="cal-swatch has"></i>有可约时间</span>',
    });

    renderDaySlots();
  }

  function slotTileHtml(s) {
    var st = asDate(s.start), ed = asDate(s.end);
    var mins = Math.round((ed - st) / 60000);
    var canHalf = !!s.allow_half && mins > 30;
    var durLabel = mins === 60 ? '1 小时' : mins + ' 分钟';

    if (s.taken) {
      return '<div class="slot-tile ' + (s.mine ? 'is-mine' : 'is-taken') + '">' +
        '<span class="tile-time">' + hhmm(st) + '</span>' +
        '<span class="tile-state">' + (s.mine ? '你家已约' : '已约满') + '</span></div>';
    }
    return '<button type="button" class="slot-tile" data-book="' + s.id + '" data-dur="' + mins + '"' +
      (canHalf ? ' data-half="1"' : '') + '>' +
      '<span class="tile-time">' + hhmm(st) + '</span>' +
      '<span class="tile-dur">' + durLabel + '</span>' +
      '<span class="tile-state">' + (canHalf ? '可上30分' : '可约') + '</span>' +
      '</button>';
  }

  // 上午 08:00–12:00 / 下午 12:00–18:00 / 晚上 18:00 之后
  var DAY_PARTS = [
    { name: '上午', from: 0, to: 12 * 60 },
    { name: '下午', from: 12 * 60, to: 18 * 60 },
    { name: '晚上', from: 18 * 60, to: 24 * 60 },
  ];

  function renderDaySlots() {
    var box = $('p-slots');
    var all = parentCal.byDay[parentCal.pickedKey] || [];
    if (!parentCal.pickedKey || !all.length) {
      box.innerHTML = emptyBox('点日历上有底色的日期，就能看到那天的可约时间。');
      return;
    }

    var list = all.slice().sort(function (a, b) { return asDate(a.start) - asDate(b.start); });
    var free = list.filter(function (s) { return !s.taken; }).length;
    var head = dayHead(parseDayKey(parentCal.pickedKey));

    var html = '<h3 class="list-head">' + esc(head.main) + ' ' + esc(head.sub) +
      ' · 共 ' + list.length + ' 节，还可约 ' + free + ' 节</h3>';

    DAY_PARTS.forEach(function (part) {
      var items = list.filter(function (s) {
        var p = sh(s.start);
        var m = p.hh * 60 + p.mi;
        return m >= part.from && m < part.to;
      });
      if (!items.length) return;

      var partFree = items.filter(function (s) { return !s.taken; }).length;
      html += '<h4 class="slot-group">' + part.name +
        '<span>' + items.length + ' 节 · 还可约 ' + partFree + '</span></h4>';
      html += '<div class="slot-grid">' + items.map(slotTileHtml).join('') + '</div>';
    });

    box.innerHTML = html;
  }

  function renderParentBookings(bookings) {
    var box = $('p-bookings');
    if (!bookings.length) {
      box.innerHTML = emptyBox('还没有约过课。上面挑一个时间试试。');
      return;
    }
    var now = Date.now();
    var upcoming = bookings.filter(function (b) {
      return b.status === 'booked' && asDate(b.start).getTime() > now;
    });
    var past = bookings.filter(function (b) {
      return !(b.status === 'booked' && asDate(b.start).getTime() > now);
    });

    var html = '';
    if (upcoming.length) {
      var g1 = groupByDay(upcoming, 'start');
      Object.keys(g1).forEach(function (k) {
        var g = g1[k];
        var head = dayHead(g.date);
        html += '<div class="day-group"><div class="day-head"><b>' + esc(head.main) + '</b><span>' + esc(head.sub) + '</span></div>';
        g.items.forEach(function (b) {
          var st = asDate(b.start);
          var realEnd = b.dur ? new Date(st.getTime() + b.dur * 60000) : asDate(b.end);
          var locked = (st.getTime() - now) < LOCK_HOURS * 3600000;
          var actions = locked
            ? '<div class="lock-note">确实有事<br>请联系老师帮你改</div>'
            : '<button class="btn btn-ghost btn-sm" data-leave="' + b.id + '">请假</button>' +
              '<button class="btn btn-danger btn-sm" data-cancel="' + b.id + '">取消</button>';
          html += '<div class="item">' +
            '<div class="time-chip">' + hhmm(st) + '</div>' +
            '<div class="item-main"><div class="item-title">' + hhmm(st) + ' – ' + hhmm(realEnd) + '</div>' +
            '<div class="item-sub">' + (b.is_makeup ? '补课' : '已预约') +
            (b.dur ? ' · ' + b.dur + ' 分钟' : '') +
            (locked ? ' · 距开课不足 ' + LOCK_HOURS + ' 小时' : '') + '</div></div>' +
            '<div class="item-actions">' + actions + '</div></div>';
        });
        html += '</div>';
      });
    }
    if (past.length) {
      if (upcoming.length) html += '<h3 class="list-head">历史记录</h3>';
      past.sort(function (a, b) { return asDate(b.start) - asDate(a.start); });
      past.slice(0, 40).forEach(function (b) {
        var st = asDate(b.start);
        var ed = b.dur ? new Date(st.getTime() + b.dur * 60000) : asDate(b.end);
        var md = mdh(st);
        var extra = b.my_note ? ' · 请假原因：' + esc(b.my_note) : '';
        if (b.note) extra += ' · 老师备注：' + esc(b.note);
        html += '<div class="item">' +
          '<div class="time-chip muted">' + hhmm(st) + '</div>' +
          '<div class="item-main"><div class="item-title">' + md + ' ' + shWeek(st) + ' ' + hhmm(st) + '–' + hhmm(ed) + '</div>' +
          '<div class="item-sub">' + statusBadge(b.status) + esc(extra) + '</div></div>' +
          '</div>';
      });
    }
    box.innerHTML = html;
  }

  function groupByDay(items, key) {
    var map = {};
    var order = [];
    items.forEach(function (it) {
      var d = asDate(it[key]);
      var k = dayKey(d);
      if (!map[k]) { map[k] = { date: d, items: [] }; order.push(k); }
      map[k].items.push(it);
    });
    order.sort(function (a, b) { return map[a].date - map[b].date; });
    var out = {};
    order.forEach(function (k) { out[k] = map[k]; });
    return out;
  }

  // ---------------------------------------------------------------- 日历
  var WEEK_HEADS = ['一', '二', '三', '四', '五', '六', '日'];

  function parseDayKey(k) {
    var p = String(k).split('-').map(Number);
    return shDate(p[0], p[1] - 1, p[2], 0, 0);
  }
  function todayStart() {
    var t = shToday();
    return shDate(t.y, t.mo, t.d, 0, 0);
  }
  // 以周一为第一列，补齐前后空位；每格是该日在北京时间的零点
  function monthCells(year, month) {
    var first = shDate(year, month, 1, 0, 0);
    var pad = (sh(first).wd + 6) % 7;
    var days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    var cells = [];
    for (var i = 0; i < pad; i++) cells.push(null);
    for (var d = 1; d <= days; d++) cells.push(shDate(year, month, d, 0, 0));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function shiftMonth(cal, delta) {
    var m = cal.month + delta;
    var y = cal.year;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    cal.month = m;
    cal.year = y;
  }

  function renderCalGrid(box, cal, opts) {
    var t0 = todayStart();
    var cells = monthCells(cal.year, cal.month);
    var picked = opts.picked || [];

    var html = '<div class="cal-head">' +
      '<button type="button" class="cal-nav" data-cal-nav="prev" data-cal-scope="' + opts.scope + '">&#8249;</button>' +
      '<div class="cal-title">' + cal.year + ' 年 ' + (cal.month + 1) + ' 月</div>' +
      '<button type="button" class="cal-nav" data-cal-nav="next" data-cal-scope="' + opts.scope + '">&#8250;</button>' +
      '</div>' +
      '<div class="cal-week">' +
      WEEK_HEADS.map(function (w) { return '<div>' + w + '</div>'; }).join('') +
      '</div><div class="cal-grid">';

    cells.forEach(function (d) {
      if (!d) { html += '<div class="cal-cell empty"></div>'; return; }
      var k = dayKey(d);
      var n = (opts.countOf && opts.countOf[k]) || 0;
      var past = d < t0;
      var cls = 'cal-cell';
      var clickable = false;

      if (past) {
        cls += ' past';
        if (n > 0) cls += ' mark';
      } else if (n > 0) {
        cls += ' has';
        clickable = true;
      }
      if (picked.indexOf(k) >= 0) cls += ' sel';
      // 老师端：未来任何一天都能点（哪怕已经排过，用来加时段）
      if (opts.mode === 'teacher' && !past) clickable = true;

      html += '<button type="button" class="' + cls + '"' +
        (clickable ? ' data-cal-pick="' + k + '" data-cal-scope="' + opts.scope + '"' : '') + '>' +
      '<span>' + sh(d).d + '</span>' +
        (n > 0 ? '<span class="cal-count">' + n + '</span>' : '') +
        '</button>';
    });

    html += '</div>';
    if (opts.legend) html += '<div class="cal-legend">' + opts.legend + '</div>';
    box.innerHTML = html;
  }

  // ---------------- 家长端事件 ----------------
  $('phone-submit').addEventListener('click', function () {
    lookupAndEnter($('phone-input').value);
  });
  $('phone-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('phone-submit').click();
  });
  $('picker-back').addEventListener('click', function () {
    $('phone-input').value = $('picker-back').getAttribute('data-phone') || '';
    show($('parent-gate'));
    hide($('parent-picker'));
  });

  $('parent-exit').addEventListener('click', async function () {
    var r = await ask({
      title: '换一个孩子？',
      text: '会退出当前页面，需要重新输入手机号。',
      okText: '退出',
    });
    if (r) {
      ls('piano_student_id', null);
      ls('piano_phone', null);
      parentState = { id: null, name: '', phone: '', kids: [], data: null };
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      $('phone-input').value = '';
      showGate();
    }
  });

  document.addEventListener('click', async function (e) {
    var pick = e.target.closest('[data-pick]');
    var b = e.target.closest('[data-book]');
    var l = e.target.closest('[data-leave]');
    var c = e.target.closest('[data-cancel]');
    var seg = e.target.closest('#slot-duration-seg .seg-btn');
    var calNav = e.target.closest('[data-cal-nav]');
    var calPick = e.target.closest('[data-cal-pick]');

    if (calNav) {
      var navScope = calNav.getAttribute('data-cal-scope');
      var delta = calNav.getAttribute('data-cal-nav') === 'next' ? 1 : -1;
      if (navScope === 'teacher') {
        shiftMonth(teacherCal, delta);
        renderTeacherCalendar();
      } else {
        shiftMonth(parentCal, delta);
        renderParentCalendar();
      }
      return;
    }

    if (calPick) {
      var pkScope = calPick.getAttribute('data-cal-scope');
      var key = calPick.getAttribute('data-cal-pick');
      if (pkScope === 'teacher') {
        if (teacherCal.picked[key]) delete teacherCal.picked[key];
        else teacherCal.picked[key] = true;
        renderTeacherCalendar();
      } else {
        parentCal.pickedKey = key;
        renderParentCalendar();
      }
      return;
    }

    if (seg) {
      slotDurationMin = Number(seg.getAttribute('data-min'));
      document.querySelectorAll('#slot-duration-seg .seg-btn').forEach(function (x) {
        x.classList.toggle('active', x === seg);
      });
      syncAllowHalf();
      updateSlotHint();
      return;
    }

    var rng = e.target.closest('#stat-range .seg-btn');
    if (rng) {
      statRange = rng.getAttribute('data-range');
      document.querySelectorAll('#stat-range .seg-btn').forEach(function (x) {
        x.classList.toggle('active', x === rng);
      });
      renderStats();
      return;
    }

    var mRow = e.target.closest('[data-month]');
    if (mRow) {
      var mk = mRow.getAttribute('data-month');
      statRange = mk;
      var tp = shToday();
      var curKey = tp.y + '-' + (tp.mo + 1);
      var lm = tp.mo - 1, ly = tp.y;
      if (lm < 0) { lm = 11; ly -= 1; }
      var lastKey = ly + '-' + (lm + 1);
      document.querySelectorAll('#stat-range .seg-btn').forEach(function (x) {
        var r = x.getAttribute('data-range');
        var on = (r === 'month' && mk === curKey) || (r === 'last' && mk === lastKey);
        x.classList.toggle('active', on);
      });
      renderStats();
      return;
    }

    if (e.target.closest('#stat-pending')) {
      var tab = document.querySelector('.tabs[data-tabs="teacher"] .tab[data-pane="pane-schedule"]');
      if (tab) tab.click();
      return;
    }

    if (pick) {
      loadParent(Number(pick.getAttribute('data-pick')), $('picker-back').getAttribute('data-phone') || parentState.phone, false);
      return;
    }

    if (b) {
      if (!parentState.id) return;
      var sid = b.getAttribute('data-book');
      var dur = Number(b.getAttribute('data-dur')) || null;
      var canHalf = b.getAttribute('data-half') === '1';
      var slot = (parentState.data.slots || []).filter(function (s) { return String(s.id) === String(sid); })[0];
      if (!slot) return;

      var st0 = asDate(slot.start);
      var when = dayHead(st0).main + ' ' + hhmm(st0);
      b.disabled = true;

      if (canHalf) {
        var base = Math.round((asDate(slot.end) - st0) / 60000);
        var pick = await askChoice({
          title: '这节课上多久？',
          text: when + ' 开始，选一个时长：',
          cancelText: '算了',
          choices: [
            { label: '上 1 小时（' + hhmm(st0) + ' – ' + hhmm(asDate(slot.end)) + '）', value: base },
            { label: '上半小时（' + hhmm(st0) + ' – ' + hhmm(new Date(st0.getTime() + 30 * 60000)) + '）', value: 30 },
          ],
        });
        if (pick === null) { b.disabled = false; return; }
        dur = pick;
      }

      var durText = '';
      if (dur === 30) {
        durText = '上半小时（' + hhmm(st0) + '–' + hhmm(new Date(st0.getTime() + 30 * 60000)) + '）';
      } else if (dur) {
        durText = '上 ' + (dur === 60 ? '1 小时' : dur + ' 分钟') +
          '（' + hhmm(st0) + '–' + hhmm(asDate(slot.end)) + '）';
      }

      var ok = await ask({
        title: '确认预约',
        text: '给 ' + parentState.name + ' 约 ' + when + ' 这节课' + (durText ? '，' + durText : '') + '？',
        okText: '确认预约',
      });
      if (!ok) { b.disabled = false; return; }
      await parentAction('parent_book', {
        p_student_id: parentState.id,
        p_phone: parentState.phone,
        p_slot_id: Number(sid),
        p_duration_min: dur,
      }, '预约成功');
      return;
    }

    if (l) {
      var lid = l.getAttribute('data-leave');
      l.disabled = true;
      var reason = await ask({
        title: '请假',
        text: '请假后这节课不计课时。\n\n方便的话说一下原因：',
        input: true, placeholder: '例如 孩子发烧',
        okText: '提交请假',
      });
      if (reason === null) { l.disabled = false; return; }
      await parentAction('parent_leave', {
        p_student_id: parentState.id, p_phone: parentState.phone,
        p_booking_id: Number(lid), p_reason: reason || '',
      }, '已请假');
      return;
    }

    if (c) {
      var cid = c.getAttribute('data-cancel');
      c.disabled = true;
      var yes = await ask({
        title: '取消这节课？',
        text: '取消后这个时段会重新开放给其他孩子。',
        okText: '确认取消',
      });
      if (!yes) { c.disabled = false; return; }
      await parentAction('parent_cancel', { p_student_id: parentState.id, p_phone: parentState.phone, p_booking_id: Number(cid) }, '已取消');
      return;
    }
  });

  async function parentAction(fn, args, okMsg) {
    var res;
    try {
      res = await db.rpc(fn, args);
    } catch (err) {
      toast('网络不稳，请重试', true);
      return;
    }
    if (res.error) { toast(res.error.message || '操作失败', true); return; }
    var data = unwrapJson(res.data);
    if (!data || !data.ok) {
      toast((data && data.error) || '操作失败', true);
      if (parentState.id) loadParent(parentState.id, parentState.phone, true);
      return;
    }
    toast(data.message || okMsg);
    loadParent(parentState.id, parentState.phone, true);
  }

  // =================================================================
  // 老师端
  // =================================================================
  var teacherState = { students: [], slots: [], bookings: [], email: '' };
  var pendingOtp = null;
  var otpCountdown = null;
  var slotDurationMin = 60; // 开时段时的单节时长，默认 1 小时，可切半小时
  var WORK_START_MIN = 8 * 60;        // 工作时间 08:00
  var WORK_END_MIN = 21 * 60 + 30;    // 工作时间 21:30（最晚这个点下课）

  function teacherEnter() {
    cloud.auth.getSession().then(function (res) {
      var session = res && res.data;
      if (session && session.user) {
        enterTeacherMain(session.user);
      } else {
        show($('teacher-auth'));
        hide($('teacher-main'));
      }
    }).catch(function () {
      show($('teacher-auth'));
      hide($('teacher-main'));
    });
  }

  function showAuthError(msg) {
    var el = $('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function clearAuthError() { $('auth-error').classList.add('hidden'); }

  function enterTeacherMain(user) {
    teacherState.email = (user && user.email) || '';
    $('t-email').textContent = teacherState.email;
    hide($('teacher-auth'));
    show($('teacher-main'));
    $('slot-start').value = '08:00';
    syncAllowHalf();
    loadTeacherData();
  }

  $('teacher-logout').addEventListener('click', async function () {
    var ok = await ask({ title: '退出登录？', text: '退出后需要重新用邮箱登录。', okText: '退出' });
    if (!ok) return;
    try { await cloud.auth.signOut(); } catch (e) { /* noop */ }
    hide($('teacher-main'));
    show($('teacher-auth'));
    $('t-email').textContent = '';
    toast('已退出');
  });

  // ---------------- 登录：邮箱验证码 ----------------
  $('otp-send').addEventListener('click', async function () {
    var email = ($('otp-email').value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('请先填写正确的邮箱'); return; }
    clearAuthError();
    $('otp-send').disabled = true;
    $('otp-send').textContent = '发送中…';
    var sent;
    try {
      sent = await cloud.auth.sendOtp({ email: email });
    } catch (err) {
      $('otp-send').disabled = false;
      $('otp-send').textContent = '获取验证码';
      showAuthError('发送失败，请稍后重试');
      return;
    }
    if (sent.error) {
      $('otp-send').disabled = false;
      $('otp-send').textContent = '获取验证码';
      showAuthError(sent.error.message || '发送失败');
      return;
    }
    pendingOtp = {
      email: email,
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser,
    };
    if (!pendingOtp.isExistingUser) {
      show($('otp-signup-extra'));
      toast('新账号：请设置一个登录密码');
    } else {
      hide($('otp-signup-extra'));
      toast('验证码已发送到邮箱');
    }
    var left = 60;
    $('otp-send').textContent = left + ' 秒后可重发';
    clearInterval(otpCountdown);
    otpCountdown = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(otpCountdown);
        $('otp-send').disabled = false;
        $('otp-send').textContent = '获取验证码';
      } else {
        $('otp-send').textContent = left + ' 秒后可重发';
      }
    }, 1000);
  });

  $('otp-submit').addEventListener('click', async function () {
    var email = ($('otp-email').value || '').trim();
    var code = ($('otp-code').value || '').trim();
    var pwd = ($('otp-password').value || '');
    if (!code) { showAuthError('请填写邮件里的验证码'); return; }
    if (!pendingOtp || pendingOtp.email !== email) { showAuthError('请先点「获取验证码」'); return; }
    if (!pendingOtp.isExistingUser && pwd.length < 6) { showAuthError('新账号请设置至少 6 位的密码'); return; }
    clearAuthError();
    $('otp-submit').disabled = true;
    var done;
    try {
      done = await cloud.auth.verifyOtp({
        email: pendingOtp.email,
        verificationId: pendingOtp.verificationId,
        isExistingUser: pendingOtp.isExistingUser,
        token: code,
        password: pendingOtp.isExistingUser ? undefined : pwd,
      });
    } catch (err) {
      $('otp-submit').disabled = false;
      showAuthError('登录失败，请重试');
      return;
    }
    $('otp-submit').disabled = false;
    if (done.error) { showAuthError(done.error.message || '验证码不正确'); return; }
    pendingOtp = null;
    $('otp-code').value = '';
    $('otp-password').value = '';
    enterTeacherMain(done.data.user);
    toast('已登录');
  });

  // ---------------- 登录：邮箱 + 密码 ----------------
  $('pwd-submit').addEventListener('click', async function () {
    var email = ($('pwd-email').value || '').trim();
    var password = $('pwd-password').value || '';
    if (!email || !password) { showAuthError('请填写邮箱和密码'); return; }
    clearAuthError();
    $('pwd-submit').disabled = true;
    var res;
    try {
      res = await cloud.auth.signInWithPassword({ email: email, password: password });
    } catch (err) {
      $('pwd-submit').disabled = false;
      showAuthError('登录失败，请重试');
      return;
    }
    $('pwd-submit').disabled = false;
    if (res.error) { showAuthError('邮箱或密码不对'); return; }
    enterTeacherMain(res.data.user);
    toast('已登录');
  });

  $('pwd-forgot').addEventListener('click', async function () {
    var email = ($('pwd-email').value || '').trim();
    if (!email) { showAuthError('请先填写邮箱'); return; }
    clearAuthError();
    var started;
    try {
      started = await cloud.auth.resetPasswordForEmail(email);
    } catch (err) {
      showAuthError('发送失败，请稍后重试');
      return;
    }
    if (started.error) { showAuthError(started.error.message || '发送失败'); return; }
    var code = await ask({
      title: '重设密码',
      text: '验证码已发到你的邮箱，请填入验证码和新密码。',
      input: true, placeholder: '验证码 / 新密码（用空格隔开）',
      okText: '重设',
    });
    if (!code) return;
    var parts = String(code).trim().split(/\s+/);
    if (parts.length < 2) { toast('请按「验证码 新密码」填写', true); return; }
    var done = await started.data.updateUser({ nonce: parts[0], password: parts[1] });
    if (done.error) { showAuthError(done.error.message || '重设失败'); return; }
    toast('密码已重设，请用新密码登录');
    enterTeacherMain(null);
  });

  // ---------------- 老师数据加载 ----------------
  async function loadTeacherData() {
    var out;
    try {
      out = await Promise.all([
        db.from('students').select('*').order('created_at', { ascending: false }),
        db.from('slots').select('*').order('start_at', { ascending: true }),
        db.from('bookings').select('*').order('created_at', { ascending: false }).limit(800),
      ]);
    } catch (err) {
      toast('数据加载失败，请稍后重试', true);
      return;
    }
    var err = out[0].error || out[1].error || out[2].error;
    if (err) { toast('数据加载失败：' + (err.message || ''), true); return; }
    teacherState.students = out[0].data || [];
    teacherState.slots = out[1].data || [];
    teacherState.bookings = out[2].data || [];
    renderTeacher();
  }

  function studentById(id) {
    return teacherState.students.filter(function (s) { return String(s.id) === String(id); })[0] || null;
  }
  function slotById(id) {
    return teacherState.slots.filter(function (s) { return String(s.id) === String(id); })[0] || null;
  }

  function renderTeacher() {
    renderSchedule();
    renderTeacherCalendar();
    renderOpenSlots();
    renderStudents();
    renderStats();
  }

  function renderSchedule() {
    var box = $('t-schedule');
    var now = Date.now();
    var rows = teacherState.bookings.map(function (b) {
      var slot = slotById(b.slot_id);
      return { b: b, slot: slot, t: slot ? asDate(slot.start_at).getTime() : 0 };
    }).filter(function (r) { return r.slot; });

    var upcoming = rows.filter(function (r) {
      return r.t >= now - 3600 * 1000 && (r.b.status === 'booked' || r.b.status === 'done');
    }).sort(function (a, b) { return a.t - b.t; });

    var recent = rows.filter(function (r) { return r.b.status !== 'booked'; })
      .sort(function (a, b) { return b.t - a.t; }).slice(0, 60);

    var html = '';
    if (!upcoming.length) {
      html += emptyBox('目前没有待上的课。去「开时段」放几个可约时间吧。');
    } else {
      html += '<h3 class="list-head">待上的课（' + upcoming.length + ' 节）</h3>';
      var g = groupByDay(upcoming.map(function (r) {
        return { start: r.slot.start_at, ref: r };
      }), 'start');
      Object.keys(g).forEach(function (k) {
        var day = g[k];
        var head = dayHead(day.date);
        html += '<div class="day-group"><div class="day-head"><b>' + esc(head.main) + '</b><span>' + esc(head.sub) + '</span></div>';
        day.items.forEach(function (it) {
          var r = it.ref, b = r.b, slot = r.slot;
          var stu = studentById(b.student_id);
          var st = asDate(slot.start_at);
          var mins = b.duration_min || Math.round((asDate(slot.end_at) - st) / 60000);
          var ed = new Date(st.getTime() + mins * 60000);
          var sub = stu ? ('剩余 ' + trimNum(num(stu.total_lessons) - num(stu.used_lessons)) + ' 节') : '学员已删除';
          html += '<div class="item">' +
            '<div class="time-chip">' + hhmm(st) + '</div>' +
            '<div class="item-main"><div class="item-title">' + esc(stu ? stu.name : '—') + ' ' + statusBadge(b.status) + '</div>' +
            '<div class="item-sub">' + hhmm(st) + '–' + hhmm(ed) + ' · ' + mins + ' 分钟 · ' + esc(sub) + '</div></div>' +
            '<div class="item-actions">' +
            (b.status === 'booked'
              ? '<button class="btn btn-primary btn-sm" data-finish="' + b.id + '">已上课</button>'
              : '<button class="btn btn-ghost btn-sm" data-unfinish="' + b.id + '">撤销</button>') +
            '<button class="btn btn-ghost btn-sm" data-free="' + b.id + '">取消</button>' +
            '</div></div>';
        });
        html += '</div>';
      });
    }

    if (recent.length) {
      html += '<h3 class="list-head">最近记录</h3>';
      recent.forEach(function (r) {
        var b = r.b, slot = r.slot, stu = studentById(b.student_id);
        var st = asDate(slot.start_at);
        var mins2 = b.duration_min || Math.round((asDate(slot.end_at) - st) / 60000);
        var ed = new Date(st.getTime() + mins2 * 60000);
        var md = mdh(st);
        var extra = b.student_note ? ' · 家长说：' + esc(b.student_note) : '';
        html += '<div class="item">' +
          '<div class="time-chip muted">' + hhmm(st) + '</div>' +
          '<div class="item-main"><div class="item-title">' + esc(stu ? stu.name : '—') + ' ' + statusBadge(b.status) + '</div>' +
          '<div class="item-sub">' + md + ' ' + hhmm(st) + '–' + hhmm(ed) + esc(extra) + '</div></div>' +
          '</div>';
      });
    }
    box.innerHTML = html;
  }

  // 老师端日历：点日期多选，一次给多天开放
  var teacherCal = { year: null, month: null, picked: {} };

  function renderTeacherCalendar() {
    if (teacherCal.year === null) {
      var t = shToday();
      teacherCal.year = t.y;
      teacherCal.month = t.mo;
    }

    var now = Date.now();
    var bookedIds = {};
    teacherState.bookings.forEach(function (b) {
      if (b.status === 'booked' || b.status === 'done') bookedIds[String(b.slot_id)] = true;
    });
    var countOf = {};
    teacherState.slots.forEach(function (s) {
      if (asDate(s.start_at).getTime() <= now) return;
      if (bookedIds[String(s.id)]) return;
      var k = dayKey(asDate(s.start_at));
      countOf[k] = (countOf[k] || 0) + 1;
    });

    var picked = Object.keys(teacherCal.picked);

    renderCalGrid($('t-cal'), teacherCal, {
      mode: 'teacher',
      scope: 'teacher',
      countOf: countOf,
      picked: picked,
      legend: '<span><i class="cal-swatch has"></i>已开放、还没人约</span>' +
        '<span><i class="cal-swatch mark"></i>已排过、约满了</span>',
    });

    var bar = $('slot-picked');
    if (picked.length) {
      $('slot-picked-count').textContent = picked.length;
      show(bar);
    } else {
      hide(bar);
    }
    updateSlotHint();
  }

  function renderOpenSlots() {
    var box = $('t-open-slots');
    var now = Date.now();
    var bookedSlotIds = {};
    teacherState.bookings.forEach(function (b) {
      if (b.status === 'booked' || b.status === 'done') bookedSlotIds[String(b.slot_id)] = true;
    });
    var free = teacherState.slots.filter(function (s) {
      return asDate(s.start_at).getTime() > now && !bookedSlotIds[String(s.id)];
    });
    if (!free.length) {
      box.innerHTML = emptyBox('没有空闲的可约时段。');
      return;
    }
    var html = '';
    var g = groupByDay(free, 'start_at');
    Object.keys(g).forEach(function (k) {
      var day = g[k];
      var head = dayHead(day.date);
      html += '<div class="day-group"><div class="day-head"><b>' + esc(head.main) + '</b><span>' + esc(head.sub) + '</span></div>';
      day.items.forEach(function (s) {
        var st = asDate(s.start_at), ed = asDate(s.end_at);
        var mins = Math.round((ed - st) / 60000);
        html += '<div class="item">' +
          '<div class="time-chip">' + hhmm(st) + '</div>' +
          '<div class="item-main"><div class="item-title">' + hhmm(st) + ' – ' + hhmm(ed) + '</div>' +
          '<div class="item-sub">' + mins + ' 分钟 · 还没人约</div></div>' +
          '<div class="item-actions"><button class="btn btn-danger btn-sm" data-delslot="' + s.id + '">删除</button></div>' +
          '</div>';
      });
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function renderStudents() {
    var box = $('t-students');
    if (!teacherState.students.length) {
      box.innerHTML = emptyBox('还没有学员。添加时填好孩子姓名和家长手机号，家长就能进来约课。');
      return;
    }
    var html = '';
    teacherState.students.forEach(function (s) {
      var remain = trimNum(num(s.total_lessons) - num(s.used_lessons));
      var noPhone = !s.guardian_phone;
      html += '<div class="item">' +
        '<div class="item-main">' +
        '<div class="item-title">' + esc(s.name) +
        (s.active ? '' : ' <span class="badge badge-cancelled">已停用</span>') +
        (noPhone ? ' <span class="badge badge-leave">缺手机号</span>' : '') + '</div>' +
        '<div class="item-sub">家长手机号 ' + esc(maskPhone(s.guardian_phone)) +
        (noPhone ? '（补上才能进入）' : '') + '</div>' +
        '<div class="item-sub">剩余 ' + remain + ' 节 / 共 ' + trimNum(s.total_lessons) + ' 节' +
        (s.guardian_note ? ' · ' + esc(s.guardian_note) : '') + '</div>' +
        '</div>' +
        '<div class="item-actions">' +
        '<button class="btn btn-ghost btn-sm" data-copy="' + s.id + '">复制</button>' +
        '<button class="btn btn-ghost btn-sm" data-editstu="' + s.id + '">编辑</button>' +
        '<button class="btn btn-danger btn-sm" data-delstu="' + s.id + '">删除</button>' +
        '</div></div>';
    });
    box.innerHTML = html;
  }

  // ---------------------------------------------------------------- 课时统计
  var statRange = 'month';

  function statWindow() {
    var p = shToday();
    if (statRange === 'all') return { from: null, to: null, label: '全部时间', key: 'all' };

    var y, m;
    if (/^\d{4}-\d{1,2}$/.test(statRange)) {
      var parts = statRange.split('-').map(Number);
      y = parts[0]; m = parts[1] - 1;
    } else {
      y = p.y; m = p.mo;
      if (statRange === 'last') { m -= 1; if (m < 0) { m = 11; y -= 1; } }
    }
    return {
      from: shDate(y, m, 1, 0, 0),
      to: shDate(y, m + 1, 1, 0, 0),
      label: y + ' 年 ' + (m + 1) + ' 月',
      key: y + '-' + (m + 1),
    };
  }

  function statRows() {
    var win = statWindow();
    var fromMs = win.from ? win.from.getTime() : null;
    var toMs = win.to ? win.to.getTime() : null;
    var done = [];

    teacherState.bookings.forEach(function (b) {
      if (b.status !== 'done') return;
      var slot = slotById(b.slot_id);
      if (!slot) return;
      var t = asDate(slot.start_at).getTime();
      if (fromMs !== null && t < fromMs) return;
      if (toMs !== null && t >= toMs) return;
      done.push({
        b: b, slot: slot, t: t,
        mins: b.duration_min || Math.round((asDate(slot.end_at) - asDate(slot.start_at)) / 60000)
      });
    });

    var totalMins = 0;
    var byStudent = {};
    done.forEach(function (r) {
      totalMins += r.mins;
      var k = String(r.b.student_id);
      if (!byStudent[k]) byStudent[k] = { n: 0, mins: 0, last: 0 };
      byStudent[k].n += 1;
      byStudent[k].mins += r.mins;
      if (r.t > byStudent[k].last) byStudent[k].last = r.t;
    });

    return { win: win, done: done, totalMins: totalMins, byStudent: byStudent };
  }

  // 逐月聚合（不限当前选中的范围，用于「按月记录」列表）
  function statByMonth() {
    var map = {};
    teacherState.bookings.forEach(function (b) {
      if (b.status !== 'done') return;
      var slot = slotById(b.slot_id);
      if (!slot) return;
      var p = sh(slot.start_at);
      var key = p.y + '-' + (p.mo + 1);
      if (!map[key]) map[key] = { key: key, y: p.y, mo: p.mo, n: 0, mins: 0, students: {} };
      map[key].n += 1;
      map[key].mins += b.duration_min ||
        Math.round((asDate(slot.end_at) - asDate(slot.start_at)) / 60000);
      map[key].students[String(b.student_id)] = true;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (b.y * 12 + b.mo) - (a.y * 12 + a.mo); });
  }

  function hours(mins) { return Math.round(mins / 60 * 10) / 10; }

  function renderStats() {
    var d = statRows();

    // 课已上完但还没核销的，提醒老师去确认
    var pend = 0;
    var nowMs = Date.now();
    teacherState.bookings.forEach(function (b) {
      if (b.status !== 'booked') return;
      var slot = slotById(b.slot_id);
      if (slot && asDate(slot.end_at).getTime() < nowMs) pend++;
    });
    var pendBox = $('stat-pending');
    if (pend > 0) {
      pendBox.innerHTML = '有 <b>' + pend + '</b> 节课已经上完了、但还没确认。' +
        '点这里去「课表」标记「已上课」，标记完就会计入统计。';
      show(pendBox);
    } else {
      hide(pendBox);
      pendBox.innerHTML = '';
    }

    $('stat-cards').innerHTML =
      '<div class="stat-card"><b>' + d.done.length + '</b><span>已上课（节）</span></div>' +
      '<div class="stat-card"><b>' + hours(d.totalMins) + '</b><span>总时长（小时）</span></div>' +
      '<div class="stat-card"><b>' + Object.keys(d.byStudent).length + '</b><span>涉及学员</span></div>';

    $('stat-note').textContent = d.win.label +
      ' · 只统计在「课表」里点过「已上课」的课，没点核销的不会算进来。';

    // 按月记录（点某个月就切到那个月）
    var months = statByMonth();
    var mBox = $('stat-months');
    if (!months.length) {
      mBox.innerHTML = emptyBox('还没有已完成的课。上完课在「课表」点「已上课」，这里就会按月攒起来。');
    } else {
      mBox.innerHTML = months.map(function (m) {
        var on = m.key === d.win.key;
        return '<button type="button" class="month-row' + (on ? ' active' : '') +
          '" data-month="' + m.key + '">' +
          '<span class="month-name">' + m.y + ' 年 ' + (m.mo + 1) + ' 月</span>' +
          '<span class="month-num">' + m.n + ' 节</span>' +
          '<span class="month-sub">' + hours(m.mins) + ' 小时 · ' +
          Object.keys(m.students).length + ' 位学员</span>' +
          '</button>';
      }).join('');
    }

    var box = $('stat-students');
    var ids = Object.keys(d.byStudent);
    if (!ids.length) {
      box.innerHTML = emptyBox('这个时间段还没有已完成的课。去「课表」点「已上课」，就会计到这里。');
      return;
    }

    ids.sort(function (a, b) { return d.byStudent[b].n - d.byStudent[a].n; });

    var html = '';
    ids.forEach(function (id) {
      var s = studentById(id);
      var st = d.byStudent[id];
      var remain = s ? trimNum(num(s.total_lessons) - num(s.used_lessons)) : '—';
      html += '<div class="item">' +
        '<div class="item-main">' +
        '<div class="item-title">' + esc(s ? s.name : '已删除学员') + '</div>' +
        '<div class="item-sub">本期 <b>' + st.n + '</b> 节 · ' + hours(st.mins) + ' 小时' +
        (st.last ? ' · 最近 ' + mdh(st.last) : '') + '</div>' +
        '<div class="item-sub">累计已上 ' + (s ? trimNum(s.used_lessons) : '—') +
        ' 节 · 剩余 <b>' + remain + '</b> 节' +
        (s ? ' / 共 ' + trimNum(s.total_lessons) + ' 节' : '') + '</div>' +
        '</div></div>';
    });
    box.innerHTML = html;
  }

  $('stat-copy').addEventListener('click', function () {
    var d = statRows();
    var lines = ['【小丁钢琴课 · 课时统计】' + d.win.label,
      '共 ' + d.done.length + ' 节 · ' + hours(d.totalMins) + ' 小时 · ' +
      Object.keys(d.byStudent).length + ' 位学员', ''];

    Object.keys(d.byStudent).forEach(function (id) {
      var s = studentById(id);
      var st = d.byStudent[id];
      var remain = s ? trimNum(num(s.total_lessons) - num(s.used_lessons)) : '—';
      lines.push((s ? s.name : '已删除学员') + '：本期 ' + st.n + ' 节（' + hours(st.mins) + ' 小时）' +
        '，累计 ' + (s ? trimNum(s.used_lessons) : '—') + ' 节，剩余 ' + remain + ' 节');
    });

    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('统计结果已复制'); })
        .catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  });

  // ---------------- 老师动作 ----------------
  document.addEventListener('click', async function (e) {
    var el;
    if ((el = e.target.closest('[data-finish]'))) { await finishBooking(el.getAttribute('data-finish'), true); return; }
    if ((el = e.target.closest('[data-unfinish]'))) { await finishBooking(el.getAttribute('data-unfinish'), false); return; }
    if ((el = e.target.closest('[data-free]'))) { await freeBooking(el.getAttribute('data-free')); return; }
    if ((el = e.target.closest('[data-delslot]'))) { await deleteSlot(el.getAttribute('data-delslot')); return; }
    if ((el = e.target.closest('[data-copy]'))) { copyEntry(el.getAttribute('data-copy')); return; }
    if ((el = e.target.closest('[data-editstu]'))) { await editStudent(el.getAttribute('data-editstu')); return; }
    if ((el = e.target.closest('[data-delstu]'))) { await deleteStudent(el.getAttribute('data-delstu')); return; }
  });

  async function finishBooking(id, done) {
    var b = teacherState.bookings.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!b) return;
    var stu = studentById(b.student_id);
    if (done) {
      var ok = await ask({
        title: '确认已上课？',
        text: (stu ? stu.name + ' ' : '') + '这节课完成后会扣 1 节课时。',
        okText: '确认',
      });
      if (!ok) return;
    }
    var r1 = await db.from('bookings').update({ status: done ? 'done' : 'booked' }).eq('id', b.id).select();
    if (r1.error || !r1.data || !r1.data.length) { toast('更新失败，请重试', true); return; }
    if (stu) {
      var delta = done ? 1 : -1;
      var next = Math.max(0, num(stu.used_lessons) + delta);
      var r2 = await db.from('students').update({ used_lessons: next }).eq('id', stu.id).select();
      if (r2.error) toast('课表已更新，但课时没扣成功，请手动核对', true);
    }
    toast(done ? '已记一次课' : '已撤销');
    loadTeacherData();
  }

  async function freeBooking(id) {
    var b = teacherState.bookings.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!b) return;
    var stu = studentById(b.student_id);
    var ok = await ask({
      title: '取消这节课？',
      text: (stu ? stu.name + ' ' : '') + '的这节课会被取消，时段重新开放给其他人约。',
      okText: '确认取消',
    });
    if (!ok) return;
    var r1 = await db.from('bookings').update({ status: 'cancelled' }).eq('id', b.id).select();
    if (r1.error) { toast('取消失败，请重试', true); return; }
    await db.from('slots').update({ status: 'open' }).eq('id', b.slot_id);
    toast('已取消');
    loadTeacherData();
  }

  async function deleteSlot(id) {
    var s = slotById(id);
    if (!s) return;
    var st = asDate(s.start_at);
    var ok = await ask({
      title: '删除这个时段？',
      text: mdh(st) + ' ' + hhmm(st) + ' 这个可约时段会被删除。',
      okText: '删除',
    });
    if (!ok) return;
    var r = await db.from('slots').delete().eq('id', s.id).select();
    if (r.error) { toast('删除失败，请重试', true); return; }
    toast('已删除');
    loadTeacherData();
  }

  function copyEntry(id) {
    var s = studentById(id);
    if (!s) return;
    var url = location.origin + location.pathname;
    var text = '小丁钢琴课 · 约课入口：' + url + '\n打开后填你的手机号就能给孩子约课。';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('入口链接已复制，发给家长即可');
      }).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('入口链接已复制'); }
    catch (e) { toast('复制失败，请手动把网址发给家长', true); }
    document.body.removeChild(ta);
  }

  async function editStudent(id) {
    var s = studentById(id);
    if (!s) return;

    var r = await askForm({
      title: '编辑学员',
      fields: [
        { key: 'name', label: '孩子姓名', value: s.name, placeholder: '例如 陈小虎' },
        { key: 'phone', label: '家长手机号（家长用它进入）', value: normPhone(s.guardian_phone), type: 'tel', placeholder: '11 位手机号' },
        { key: 'total', label: '总课时', value: trimNum(s.total_lessons), type: 'number' },
        { key: 'used', label: '已上次数', value: trimNum(s.used_lessons), type: 'number' },
        { key: 'note', label: '备注（可选）', value: s.guardian_note || '', placeholder: '例如 妈妈' },
        { key: 'active', label: '启用（关掉后这个孩子的家长就进不来了，记录保留）', type: 'check', value: !!s.active },
      ],
      okText: '保存',
    });
    if (!r) return;

    var name = String(r.name || '').trim();
    var phone = normPhone(r.phone);
    var total = Number(r.total);
    var used = Number(r.used);
    var note = String(r.note || '').trim();

    if (!name) { toast('孩子姓名不能空', true); return; }
    if (phone.length !== 11) { toast('家长手机号要 11 位', true); return; }
    if (!isFinite(total) || total < 0) { toast('总课时请填数字', true); return; }
    if (!isFinite(used) || used < 0) { toast('已上次数请填数字', true); return; }

    var up = await db.from('students').update({
      name: name,
      guardian_phone: phone,
      total_lessons: total,
      used_lessons: used,
      guardian_note: note || null,
      active: !!r.active,
    }).eq('id', s.id).select();
    if (up.error || !up.data || !up.data.length) { toast('保存失败，请重试', true); return; }
    toast('已保存');
    loadTeacherData();
  }

  async function deleteStudent(id) {
    var s = studentById(id);
    if (!s) return;

    var related = teacherState.bookings.filter(function (b) {
      return String(b.student_id) === String(id) && (b.status === 'booked' || b.status === 'done');
    });

    var warn = '删掉后这个孩子就彻底没了，家长也进不来。\n\n';
    if (related.length) {
      warn += '注意：TA 还有 ' + related.length + ' 条约课记录，会跟着一起删掉，找不回来。\n\n';
    }
    warn += '如果只是暂时不学了，建议用「编辑」把「启用」关掉，记录还能留着。';

    var ok = await ask({
      title: '删除「' + s.name + '」？',
      text: warn,
      okText: '确认删除',
      cancelText: '不删',
    });
    if (!ok) return;

    var r = await db.from('students').delete().eq('id', s.id).select();
    if (r.error) { toast('删除失败：' + (r.error.message || ''), true); return; }
    if (!r.data || !r.data.length) { toast('没删掉，可能已经不存在了', true); return; }
    toast('已删除「' + s.name + '」');
    loadTeacherData();
  }

  // 添加学员
  $('stu-create').addEventListener('click', async function () {
    var name = ($('stu-name').value || '').trim();
    var phone = normPhone($('stu-phone').value);
    var total = Number($('stu-total').value);
    var note = ($('stu-note').value || '').trim();
    if (!name) { toast('请填孩子姓名', true); return; }
    if (phone.length !== 11) { toast('请填 11 位家长手机号', true); return; }
    if (!isFinite(total) || total < 0) { toast('总课时请填数字', true); return; }

    $('stu-create').disabled = true;
    var res = await db.from('students').insert({
      name: name,
      guardian_phone: phone,
      total_lessons: total,
      guardian_note: note || null,
    }).select();
    $('stu-create').disabled = false;
    if (res.error) { toast('添加失败：' + (res.error.message || ''), true); return; }
    $('stu-name').value = '';
    $('stu-phone').value = '';
    $('stu-note').value = '';
    toast('已添加，家长用 ' + maskPhone(phone) + ' 就能进入');
    loadTeacherData();
  });

  // 每天能排的起始分钟数（不超过 21:30）
  function buildDayMins(startStr, duration, gap, count) {
    var hm = String(startStr || '').split(':').map(Number);
    if (hm.length < 2 || !isFinite(hm[0]) || !isFinite(hm[1])) return [];
    var cur = hm[0] * 60 + hm[1];
    if (cur < WORK_START_MIN) return [];
    var g = (isFinite(gap) && gap >= 0) ? gap : 0;
    var n = (isFinite(count) && count > 0) ? Math.min(count, 40) : 0;
    var out = [];
    for (var i = 0; i < n; i++) {
      if (cur + duration > WORK_END_MIN) break;
      out.push(cur);
      cur += duration + g;
    }
    return out;
  }

  // 「家长也可以只约半小时」只在每节 1 小时时有意义
  function syncAllowHalf() {
    var cb = $('slot-allow-half');
    if (!cb) return;
    if (slotDurationMin !== 60) {
      cb.checked = false;
      cb.disabled = true;
    } else {
      cb.disabled = false;
    }
  }

  // 「开放可约时段」里的实时提示
  function updateSlotHint() {
    var el = $('slot-hint');
    if (!el) return;
    var startStr = $('slot-start').value;
    if (!startStr) { el.textContent = ''; return; }

    var hm = startStr.split(':').map(Number);
    if (hm[0] * 60 + hm[1] < WORK_START_MIN) {
      el.textContent = '工作时间从早上 08:00 开始';
      return;
    }

    var perDay = buildDayMins(startStr, slotDurationMin, Number($('slot-gap').value), Number($('slot-count').value));
    if (!perDay.length) {
      el.textContent = '这个开始时间放不下一节课了（工作时间到 21:30）';
      return;
    }

    var pickedCount = Object.keys(teacherCal.picked).length;
    var tail = '每天 ' + perDay.length + ' 节（' + startStr + ' 起，最晚 21:30）';

    if (!pickedCount) {
      el.textContent = '还没选日期 · ' + tail;
      return;
    }
    var want = Number($('slot-count').value);
    var tip = '已选 ' + pickedCount + ' 天 × ' + tail + ' = 最多 ' + (pickedCount * perDay.length) + ' 个时段';
    if (isFinite(want) && want > perDay.length) tip += '（填的 ' + want + ' 节被截到 ' + perDay.length + ' 节）';
    el.textContent = tip;
  }

  $('slot-start').addEventListener('input', updateSlotHint);
  $('slot-gap').addEventListener('input', updateSlotHint);
  $('slot-count').addEventListener('input', updateSlotHint);

  // 给日历上选中的日期批量开放时段
  $('slot-create').addEventListener('click', async function () {
    var days = Object.keys(teacherCal.picked).sort(function (a, b) { return parseDayKey(a) - parseDayKey(b); });
    if (!days.length) { toast('先在日历上点选要开放的日期', true); return; }

    var startStr = $('slot-start').value;
    var duration = slotDurationMin;
    var gap = Number($('slot-gap').value);
    var count = Number($('slot-count').value);

    if (!startStr) { toast('请填每天几点开始', true); return; }
    var hm = startStr.split(':').map(Number);
    if (hm[0] * 60 + hm[1] < WORK_START_MIN) { toast('工作时间从早上 08:00 开始', true); return; }
    if (hm[0] * 60 + hm[1] >= WORK_END_MIN) { toast('工作时间到晚上 21:30，不能再晚了', true); return; }
    if (!isFinite(count) || count < 1) { toast('每天排几节请填 1 以上', true); return; }

    var mins = buildDayMins(startStr, duration, gap, count);
    if (!mins.length) { toast('这个开始时间放不下课了（工作时间到 21:30）', true); return; }

    var now = Date.now();
    var exists = {};
    teacherState.slots.forEach(function (s) { exists[asDate(s.start_at).getTime()] = true; });

    var allowHalf = $('slot-allow-half').checked && duration === 60;
    var rows = [];
    var dup = 0;
    var skipped = 0;

    days.forEach(function (k) {
      var pd = sh(parseDayKey(k));
      mins.forEach(function (m) {
        var st = shDate(pd.y, pd.mo, pd.d, Math.floor(m / 60), m % 60);
        var ms = st.getTime();
        if (ms + duration * 60000 <= now) { skipped++; return; }
        if (exists[ms]) { dup++; return; }
        exists[ms] = true;
        rows.push({
          start_at: st.toISOString(),
          end_at: new Date(ms + duration * 60000).toISOString(),
          status: 'open',
          allow_half: allowHalf
        });
      });
    });

    if (!rows.length) {
      toast(dup ? '这些时段之前已经开放过了' : '这些日期都排不下课了', true);
      return;
    }

    $('slot-create').disabled = true;
    var inserted = 0;
    var CHUNK = 50;
    for (var i = 0; i < rows.length; i += CHUNK) {
      var res = await db.from('slots').insert(rows.slice(i, i + CHUNK)).select();
      if (res.error) {
        $('slot-create').disabled = false;
        toast('写入中断（已成功 ' + inserted + ' 条）：' + (res.error.message || ''), true);
        loadTeacherData();
        return;
      }
      inserted += (res.data && res.data.length) || 0;
    }
    $('slot-create').disabled = false;

    teacherCal.picked = {};
    var msg = '已为 ' + days.length + ' 天开放 ' + inserted + ' 个时段（每节 ' + duration + ' 分钟）';
    if (dup) msg += '；' + dup + ' 个已存在，跳过';
    if (skipped) msg += '；' + skipped + ' 个已过去，跳过';
    toast(msg);
    loadTeacherData();
  });

  $('slot-picked-clear').addEventListener('click', function () {
    teacherCal.picked = {};
    renderTeacherCalendar();
  });

  // ---------------------------------------------------------------- 启动
  (function boot() {
    var urlPhone = normPhone(new URLSearchParams(location.search).get('phone'));
    if (urlPhone) { go('parent'); return; }
    if (ls('piano_student_id') && ls('piano_phone')) { go('parent'); return; }
    cloud.auth.getSession().then(function (res) {
      if (res && res.data && res.data.user) go('teacher');
    }).catch(function () { /* noop */ });
  })();

  window.__piano = { cloud: cloud, go: go };
})();
