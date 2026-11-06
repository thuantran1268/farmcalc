/* FarmCalc · Khóa bảng giá.
 * Bảng giá KHÔNG nằm trong web. Chỉ tài khoản đã được admin duyệt, đăng nhập trên đúng
 * thiết bị đang dùng, mới lấy được dữ liệu từ Supabase (hàm farmcalc_get_prices).
 * Phát hai sự kiện cho index.html:
 *   'farm-prices'      detail = {products:[...], effectiveDate, updatedAt, priceAdjustmentKg}
 *   'farm-prices-lock' khi bị khóa lại (đăng xuất, thu hồi, đăng nhập ở máy khác)
 */
(function () {
  'use strict';
  var cfg = window.FARMCALC_CONFIG || {};
  var configured = /^https:\/\/[^/]+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '') &&
    cfg.supabaseAnonKey && String(cfg.supabaseAnonKey).indexOf('THAY_BANG_') !== 0;
  var base = configured ? cfg.supabaseUrl.replace(/\/$/, '') : '';
  var SKEY = 'farmcalc-price-session-v1', DKEY = 'farmcalc-device-v1';

  var session = null;      // {access_token, refresh_token, expires_at, email}
  var state = configured ? 'loading' : 'nocfg'; // nocfg | loading | locked | pending | rejected | ready
  var mode = 'login';      // login | signup (form đang hiển thị)
  var message = '', busy = false, who = '', lastEmail = '', role = '';
  var members = null, membersAt = 0, adminBoxes = [], justApproved = {};
  var panels = [], rows = [];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function deviceId() {
    var d = lsGet(DKEY);
    if (!d || d.length < 8) {
      d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      lsSet(DKEY, d);
    }
    return d;
  }

  function loadSession() {
    try { var s = JSON.parse(lsGet(SKEY) || 'null'); if (s && s.refresh_token) session = s; } catch (e) {}
  }
  function saveSession(j, email) {
    session = {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      email: email || (j.user && j.user.email) || (session && session.email) || ''
    };
    lsSet(SKEY, JSON.stringify(session));
  }
  function clearSession() { session = null; lsDel(SKEY); }

  var VN = {
    'Invalid login credentials': 'Sai email hoặc mật khẩu.',
    'User already registered': 'Email này đã đăng ký rồi. Hãy chọn "Đăng nhập".',
    'Email not confirmed': 'Email chưa được xác nhận.',
    'not_approved': 'Tài khoản chưa được duyệt.',
    'device_changed': 'Tài khoản đang được dùng ở thiết bị khác. Hãy đăng nhập lại để dùng ở máy này.',
    'no_data': 'Chưa có dữ liệu bảng giá. Hãy báo admin.',
    'not_logged_in': 'Hết phiên đăng nhập. Hãy đăng nhập lại.'
  };
  function vn(text) {
    text = String(text || '');
    for (var k in VN) if (text.indexOf(k) !== -1) return VN[k];
    if (/password.*(at least|short|weak)/i.test(text)) return 'Mật khẩu quá ngắn (tối thiểu 8 ký tự).';
    if (/rate limit|too many/i.test(text)) return 'Thử quá nhiều lần. Hãy chờ ít phút rồi thử lại.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'Không kết nối được mạng.';
    return text || 'Có lỗi xảy ra.';
  }
  function errCode(e) { return String((e && e.message) || e); }

  async function authCall(path, body) {
    var r = await fetch(base + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || j.error || ('Lỗi ' + r.status));
    return j;
  }

  async function freshToken() {
    if (!session) throw new Error('not_logged_in');
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    try {
      var j = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      saveSession(j, session.email);
      return session.access_token;
    } catch (e) { clearSession(); throw new Error('not_logged_in'); }
  }

  async function rpc(name, args) {
    var token = await freshToken();
    var r = await fetch(base + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    var txt = await r.text(), j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!r.ok) {
      if (r.status === 401) { clearSession(); throw new Error('not_logged_in'); }
      throw new Error((j && (j.message || j.hint)) || ('Lỗi ' + r.status));
    }
    return j;
  }

  function emitLock() { window.dispatchEvent(new CustomEvent('farm-prices-lock')); }
  function emitData(d) { window.dispatchEvent(new CustomEvent('farm-prices', { detail: d })); }

  var PKEY = 'farmcalc-price-pending-v1';
  function toast(text) {
    var t = document.createElement('div');
    t.className = 'pg-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    t.onclick = function () { t.remove(); };
    document.body.append(t);
    setTimeout(function () { t.remove(); }, 7000);
  }
  function setState(s, msg) {
    var was = state;
    state = s; message = msg || '';
    if (s === 'pending' && who) lsSet(PKEY, who);
    if (s === 'ready') {
      var p = lsGet(PKEY);
      if (p && p === who) toast('Tài khoản ' + who + ' đã được admin duyệt. Bảng giá đã mở!');
      lsDel(PKEY);
    }
    if (s === 'rejected') lsDel(PKEY);
    if (was === 'ready' && s !== 'ready') emitLock();
    redraw();
  }

  async function fetchPrices() {
    var d = await rpc('farmcalc_get_prices', { p_device: deviceId() });
    setState('ready');
    emitData(d);
  }

  function lockedWith(code) {
    if (code === 'device_changed' || code === 'not_logged_in') {
      clearSession(); who = '';
      setState('locked', vn(code));
    } else if (code === 'not_approved') {
      setState('pending');
    } else setState(state === 'ready' ? 'ready' : 'locked', vn(code));
  }

  // Sau khi đăng nhập/đăng ký: nhận máy này làm thiết bị duy nhất, rồi xem trạng thái
  async function afterSignIn() {
    var st = await rpc('farmcalc_claim_device', { p_device: deviceId() });
    who = st.email || (session && session.email) || ''; role = st.role || '';
    if (st.status === 'approved') {
      try { await fetchPrices(); } catch (e) { lockedWith(errCode(e)); }
    } else if (st.status === 'rejected') setState('rejected');
    else setState('pending');
  }

  async function submit(email, password) {
    if (busy) return;
    busy = true; message = ''; redraw();
    try {
      email = String(email || '').trim().toLowerCase(); lastEmail = email;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không đúng định dạng.');
      if (String(password || '').length < 8) throw new Error('Mật khẩu cần ít nhất 8 ký tự.');
      var j;
      if (mode === 'signup') {
        j = await authCall('signup', { email: email, password: password });
        if (!j.access_token) {
          busy = false;
          setState('locked', 'Supabase đang bắt xác nhận email. Hãy tắt "Confirm email" trong Authentication → Providers → Email, hoặc bấm đường link trong thư rồi chọn "Đăng nhập".');
          return;
        }
      } else {
        j = await authCall('token?grant_type=password', { email: email, password: password });
      }
      saveSession(j, email);
      await afterSignIn();
    } catch (e) {
      message = vn(errCode(e));
      if (state !== 'locked') state = 'locked';
      redraw();
    } finally { busy = false; redraw(); }
  }

  async function recheck(manual) {
    if (!session || busy) return;
    if (state === 'ready') { // chỉ kiểm tra còn quyền không, không vẽ lại web đang dùng
      try { await rpc('farmcalc_get_prices', { p_device: deviceId() }); } catch (e) { lockedWith(errCode(e)); }
      return;
    }
    if (manual) { message = ''; busy = true; redraw(); }
    try {
      var st = await rpc('farmcalc_my_status');
      who = st.email || who; role = st.role || '';
      if (st.status === 'approved') {
        try { await fetchPrices(); } catch (e) { lockedWith(errCode(e)); }
      } else if (st.status === 'rejected') setState('rejected');
      else setState('pending', manual ? 'Chưa được duyệt. Hãy thử lại sau.' : '');
    } catch (e) { lockedWith(errCode(e)); }
    finally { if (manual) { busy = false; redraw(); } }
  }

  function logout() {
    clearSession(); who = ''; role = ''; members = null;
    setState('locked', '');
  }

  /* ---------- Giao diện ---------- */
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function draw(box) {
    box.replaceChildren();
    if (state === 'nocfg') {
      box.append(el('h3', 'Bảng giá đang khóa'),
        el('p', 'Chế độ chạy thử: web chưa nối với Supabase nên chưa có bảng giá.', 'pg-note'));
      return;
    }
    if (state === 'loading') { box.append(el('p', 'Đang kiểm tra tài khoản…', 'pg-note')); return; }
    if (state === 'pending') {
      box.append(el('h3', 'Đang chờ duyệt'),
        el('p', 'Yêu cầu của ' + (who || 'bạn') + ' đã gửi tới admin. Khi được duyệt, bảng giá sẽ hiện ra ở đây.', 'pg-note'));
      if (message) box.append(el('p', message, 'pg-msg'));
      var b = el('button', busy ? 'Đang kiểm tra…' : 'Kiểm tra lại', 'pg-btn');
      b.type = 'button'; b.disabled = busy; b.onclick = function () { recheck(true); };
      var o = el('button', 'Dùng email khác', 'pg-link'); o.type = 'button'; o.onclick = logout;
      box.append(b, o);
      return;
    }
    if (state === 'rejected') {
      box.append(el('h3', 'Chưa được cấp quyền'),
        el('p', 'Tài khoản ' + (who || '') + ' chưa được phép xem bảng giá. Hãy liên hệ admin.', 'pg-note'));
      var o2 = el('button', 'Dùng email khác', 'pg-link'); o2.type = 'button'; o2.onclick = logout;
      box.append(o2);
      return;
    }
    if (state === 'ready') { box.append(el('p', 'Đã mở khóa bảng giá.', 'pg-note')); return; }

    // locked: form đăng ký / đăng nhập
    box.append(el('h3', 'Bảng giá được bảo vệ'),
      el('p', 'Chỉ người được admin duyệt mới xem được. Đăng ký một lần; lần sau máy này tự đăng nhập. Mỗi tài khoản chỉ dùng trên 1 thiết bị.', 'pg-note'));
    var tabs = el('div', undefined, 'pg-tabs');
    [['login', 'Đăng nhập'], ['signup', 'Đăng ký xin quyền']].forEach(function (t) {
      var x = el('button', t[1]); x.type = 'button';
      x.setAttribute('aria-pressed', String(mode === t[0]));
      x.onclick = function () { mode = t[0]; message = ''; redraw(); };
      tabs.append(x);
    });
    var form = el('form', undefined, 'pg-form'); form.noValidate = true;
    var em = el('input'); em.type = 'email'; em.placeholder = 'Email'; em.autocomplete = 'username';
    em.required = true; em.setAttribute('aria-label', 'Email'); em.value = lastEmail;
    var pw = el('input'); pw.type = 'password'; pw.placeholder = mode === 'signup' ? 'Tạo mật khẩu (từ 8 ký tự)' : 'Mật khẩu';
    pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password'; pw.required = true;
    pw.minLength = 8; pw.setAttribute('aria-label', 'Mật khẩu');
    var go = el('button', busy ? 'Đang gửi…' : (mode === 'signup' ? 'Gửi yêu cầu xem bảng giá' : 'Đăng nhập'), 'pg-btn');
    go.type = 'submit'; go.disabled = busy;
    form.append(em, pw, go);
    form.onsubmit = function (ev) { ev.preventDefault(); submit(em.value, pw.value); };
    box.append(tabs, form);
    if (message) { var m = el('p', message, 'pg-msg'); m.setAttribute('role', 'alert'); box.append(m); }
  }

  function drawRow(row) {
    row.replaceChildren();
    row.append(el('strong', 'Bảng giá'));
    if (state === 'ready') {
      row.append(el('span', ' · đã mở khóa cho ' + (who || (session && session.email) || ''), 'pg-note'));
      var b = el('button', 'Đăng xuất bảng giá', 'pg-link'); b.type = 'button'; b.onclick = logout;
      row.append(b);
    } else if (state === 'pending') row.append(el('span', ' · đang chờ admin duyệt', 'pg-note'));
    else if (state === 'nocfg') row.append(el('span', ' · chạy thử, chưa có dữ liệu', 'pg-note'));
    else row.append(el('span', ' · đang khóa. Mở tab Bảng giá để xin quyền xem.', 'pg-note'));
  }

  function redraw() {
    panels = panels.filter(function (p) { return document.body.contains(p); });
    panels.forEach(draw);
    rows.forEach(drawRow);
  }


  /* ---------- Quản lý tài khoản (chỉ admin thấy) ---------- */
  var ST = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  function when(t) {
    if (!t) return '—';
    var d = new Date(t);
    return isNaN(d) ? '—' : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  async function loadMembers(force) {
    if (!force && members && Date.now() - membersAt < 30000) return;
    members = await rpc('farmcalc_admin_members');
    membersAt = Date.now();
  }
  function pendingCount() { return members ? members.filter(function (m) { return m.status === 'pending'; }).length : 0; }
  function drawAdmin(box) {
    if (box._isBtn) {
      box.replaceChildren(document.createTextNode('Tài khoản'));
      var n = pendingCount();
      if (n) box.append(el('span', String(n), 'pg-badge'));
      box.setAttribute('aria-label', 'Quản lý tài khoản' + (n ? ', ' + n + ' chờ duyệt' : ''));
      return;
    }
    box.replaceChildren();
    if (members) box.append(el('p', members.length + ' tài khoản · ' + pendingCount() + ' đang chờ duyệt', 'pg-note'));
    if (!members) { box.append(el('p', 'Đang tải danh sách…', 'pg-note')); return; }
    if (box._err) box.append(el('p', box._err, 'pg-msg'));
    var list = el('div', undefined, 'pg-members');
    members.forEach(function (m) {
      var it = el('div', undefined, 'pg-member pg-' + m.status);
      var top = el('div', undefined, 'pg-mtop');
      top.append(el('strong', m.email + (m.role === 'admin' ? ' (admin)' : '')), el('span', ST[m.status] || m.status, 'pg-st'));
      it.append(top, el('small', 'Đăng ký ' + when(m.created_at) + ' · thiết bị: ' + (m.device_at ? 'đăng nhập ' + when(m.device_at) : 'chưa đăng nhập'), 'pg-note'));
      if (m.role !== 'admin') {
        var acts = el('div', undefined, 'pg-acts');
        function act(label, fn, ghost) {
          var b = el('button', label, ghost ? 'pg-ghost' : 'pg-btn'); b.type = 'button';
          b.onclick = async function () {
            b.disabled = true; box._err = '';
            try { await fn(); await loadMembers(true); } catch (e) { box._err = 'Không thực hiện được: ' + vn(errCode(e)); }
            adminBoxes.forEach(drawAdmin);
          };
          acts.append(b);
        }
        if (m.status !== 'approved') act('Duyệt', function () { return rpc('farmcalc_admin_set_status', { p_user: m.user_id, p_status: 'approved' }).then(function () { justApproved[m.user_id] = 1; }); });
        if (m.status !== 'rejected') act(m.status === 'approved' ? 'Thu hồi' : 'Từ chối', function () { return rpc('farmcalc_admin_set_status', { p_user: m.user_id, p_status: 'rejected' }); }, true);
        if (m.status === 'approved' && m.device_at) act('Đặt lại thiết bị', function () { return rpc('farmcalc_admin_reset_device', { p_user: m.user_id }); }, true);
        it.append(acts);
        if (m.status === 'approved' && justApproved[m.user_id]) it.append(notifyRow(m.email));
      }
      list.append(it);
    });
    if (!members.length) list.append(el('p', 'Chưa có ai đăng ký.', 'pg-note'));
    var rf = el('button', 'Tải lại danh sách', 'pg-link'); rf.type = 'button';
    rf.onclick = function () { members = null; adminBoxes.forEach(drawAdmin); refreshAdmin(true); };
    box.append(list, rf);
  }
  function notifyText(email) {
    var link = location.origin + location.pathname.replace(/[^/]*$/, '');
    return 'Chào anh/chị, tài khoản ' + email + ' đã được duyệt xem bảng giá FarmCalc. ' +
      'Mở ' + link + ' → tab Bảng giá → Đăng nhập bằng email và mật khẩu đã đăng ký.';
  }
  function notifyRow(email) {
    var row = el('div', undefined, 'pg-notify');
    row.append(el('small', 'Đã duyệt. Báo cho khách:', 'pg-note'));
    var mail = el('a', 'Gửi email', 'pg-ghost');
    mail.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent('FarmCalc: tài khoản xem bảng giá đã được duyệt') + '&body=' + encodeURIComponent(notifyText(email));
    var cp = el('button', 'Chép tin nhắn (Zalo)', 'pg-ghost'); cp.type = 'button';
    cp.onclick = async function () {
      try { await navigator.clipboard.writeText(notifyText(email)); cp.textContent = 'Đã chép, dán vào Zalo'; }
      catch (e) { window.prompt('Chép tin nhắn này:', notifyText(email)); }
    };
    row.append(mail, cp);
    return row;
  }
  function refreshAdmin(force) {
    loadMembers(force).then(function () { adminBoxes.forEach(drawAdmin); })
      .catch(function (e) { adminBoxes.forEach(function (b) { b._err = vn(errCode(e)); drawAdmin(b); }); });
  }
  function closeModal() {
    var o = document.querySelector('.pg-overlay');
    if (o) o.remove();
    document.removeEventListener('keydown', escClose);
    document.body.classList.remove('pg-noscroll');
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function openModal() {
    closeModal();
    var ov = el('div', undefined, 'pg-overlay');
    var sheet = el('div', undefined, 'pg-sheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Quản lý tài khoản');
    var head = el('div', undefined, 'pg-sheet-head');
    var x = el('button', '×', 'pg-x'); x.type = 'button'; x.setAttribute('aria-label', 'Đóng'); x.onclick = closeModal;
    head.append(el('h3', 'Quản lý tài khoản'), x);
    var body = el('div', undefined, 'pg-sheet-body');
    sheet.append(head, body);
    ov.append(sheet);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.body.append(ov);
    document.body.classList.add('pg-noscroll');
    document.addEventListener('keydown', escClose);
    adminBoxes = adminBoxes.filter(function (b) { return document.body.contains(b); });
    adminBoxes.push(body);
    drawAdmin(body);
    refreshAdmin(false);
  }
  function adminButton() {
    var b = el('button', undefined, 'action pg-adm-btn');
    b.type = 'button'; b._isBtn = true;
    b.onclick = openModal;
    adminBoxes = adminBoxes.filter(function (x) { return document.body.contains(x); });
    adminBoxes.push(b);
    drawAdmin(b);
    refreshAdmin(false);
    return b;
  }


  window.farmPriceGate = {
    panel: function () {
      var box = el('div', undefined, 'pg-panel');
      panels.push(box); draw(box);
      return box;
    },
    logout: logout,
    isAdmin: function () { return state === 'ready' && role === 'admin'; },
    adminButton: adminButton,
    state: function () { return state; }
  };

  function mountRow() {
    var host = document.getElementById('fc-more-account');
    if (!host) return;
    var row = el('div', undefined, 'pg-row');
    host.append(row); rows.push(row); drawRow(row);
  }

  function boot() {
    mountRow();
    if (!configured) return;
    loadSession();
    if (!session) { setState('locked'); return; }
    who = session.email || '';
    recheck(false);
    setInterval(function () { if (state === 'pending' || state === 'ready') recheck(false); }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && (state === 'pending' || state === 'ready')) recheck(false);
    });
  }
  boot();
})();
