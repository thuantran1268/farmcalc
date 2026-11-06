/* Ghi nhật ký sử dụng (chỉ khi đã nối Supabase). Chỉ gửi: email, tính năng, chi tiết ngắn, mã phiên, loại thiết bị.
   Không gửi số liệu nhập, số chính sách hay giá. Gửi lỗi thì bỏ qua, không ảnh hưởng người dùng. */
(function () {
  'use strict';
  var cfg = window.FARMCALC_CONFIG || {};
  var ok = /^https:\/\/[^/]+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '') && cfg.supabaseAnonKey && cfg.supabaseAnonKey.indexOf('THAY_BANG_') !== 0;
  var session = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  var device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  function track(feature, detail) {
    if (!ok) return;
    var email = window.farmUserEmail ? String(window.farmUserEmail() || '').toLowerCase() : '';
    if (!email) return;
    var body = { email: email, feature: feature, detail: detail ? String(detail).slice(0, 60) : null, session: session, device: device };
    try {
      fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/farmcalc_activity', {
        method: 'POST', keepalive: true,
        headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }
  window.farmTrack = track;
  function onReady() {
    var app = document.getElementById('app');
    if (!app) return;
    var opened = false;
    function check() { if (!app.hidden && !opened) { opened = true; track('open'); } if (app.hidden) opened = false; }
    new MutationObserver(check).observe(app, { attributes: true, attributeFilter: ['hidden'] });
    check();
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var nav = t.closest('#fc-bottom-nav button[data-view]');
      if (nav) return track('view', nav.dataset.view);
      var tab = t.closest('.tabs [role=tab]');
      if (tab && e.isTrusted && tab.dataset.tab !== 'catalog') return track('tab', tab.dataset.tab);
      if (t.closest('#save-history')) return track('save', window.farmCurrent ? window.farmCurrent() : '');
      if (t.closest('.cat-head button')) { var p = document.querySelector('.catalog-policy'); return track('pdf', p && Number(p.value) > 0 ? 'net' : 'hoa-don'); }
      if (t.closest('#fc-open-tools')) return track('tools', 'mo');
      var tt = t.closest('#fc-tool-tabs button'); if (tt) return track('tools', tt.textContent.trim());
      if (t.closest('#install-guide summary') || t.closest('#install-app')) return track('install');
      if (t.closest('#print')) return track('print');
      if (t.closest('#fm-xls-link')) return track('market', 'excel');
    }, true);
    var mp = document.getElementById('fm-product');
    if (mp) mp.addEventListener('change', function () { track('market', mp.value); });
    var pol = null, polTimer;
    document.addEventListener('input', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('catalog-policy')) {
        clearTimeout(polTimer); polTimer = setTimeout(function () { track('policy', Number(e.target.value) > 0 ? 'bat' : 'tat'); }, 1500);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
})();
