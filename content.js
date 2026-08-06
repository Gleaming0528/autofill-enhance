// ==================== 自动填充增强 ====================
// ISOLATED world content script：独立 JS 上下文，天然绕过任何 CSP。
// 与页面共享 DOM 树，可安全修改属性、派发事件。
// HTMLInputElement.prototype 是浏览器原生实现，不被页面框架污染。

(function () {
  'use strict';

  var TAG = '[AutoFill]';
  var OTP_RE = /安全码|验证码|校验码|动态码|口令|otp|totp|mfa|2fa|security.?code|verif|one.?time|auth.?code|token/i;
  var DIGIT_RE = /^\d{4,8}$/;
  var BLOCKED_AC = { off: 1, 'false': 1, nope: 1, disabled: 1, 'new-password': 1 };
  var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  var nativeGet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
  var processed = new WeakSet();
  var otpFields = new WeakSet();

  // ==================== React / Vue 受控组件兼容 ====================
  // ISOLATED world 无法访问 _valueTracker（页面 JS 上下文的自定义属性）。
  // 但 nativeSet 直接修改共享 DOM 值 → dispatchEvent 触发页面框架的事件监听
  // → 框架检测到 DOM 值与内部状态不一致 → 触发 onChange → 状态更新。
  function forceUpdate(el, value) {
    nativeSet.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isOtpField(el) {
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    if (['text', 'tel', 'number', 'password'].indexOf(t) === -1) return false;
    var hints = [
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('aria-label')
    ];
    try { hints.push(el.closest('.next-form-item').querySelector('label').textContent); } catch (e) {}
    try { hints.push(el.closest('.form-group').querySelector('label').textContent); } catch (e) {}
    try { hints.push(el.closest('.form-item').querySelector('label').textContent); } catch (e) {}
    try { hints.push(el.closest('[class*="form"]').querySelector('label').textContent); } catch (e) {}
    return OTP_RE.test(hints.filter(Boolean).join(' '));
  }

  // ==================== 粘贴拦截 ====================
  document.addEventListener('paste', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !processed.has(el)) return;
    var text = (e.clipboardData ? e.clipboardData.getData('text') : '').trim();
    if (!text) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    forceUpdate(el, text);
    console.log(TAG, '粘贴填入', text.length + ' 位');
  }, true);

  // ==================== 输入框解锁 ====================
  function unlock(root) {
    if (!root || !root.querySelectorAll) return;
    var inputs = root.querySelectorAll('input, select, textarea');
    var els = [];
    if (root.matches && root.matches('input, select, textarea')) els.push(root);
    for (var i = 0; i < inputs.length; i++) els.push(inputs[i]);

    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      if (processed.has(el)) continue;
      processed.add(el);

      var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      var otp = isOtpField(el);

      if (!ac || ac in BLOCKED_AC) {
        el.setAttribute('autocomplete', otp ? 'one-time-code' : 'on');
      }

      if (otp) {
        otpFields.add(el);
        if (!el.name) el.setAttribute('name', 'otp');
        console.log(TAG, 'OTP 字段:', el.placeholder || el.name || '(unknown)');
        bindClipboardFill(el);
        watchExternalFill(el);
      }

      el.removeAttribute('onpaste');
      if (el.tagName === 'INPUT' && el.hasAttribute('readonly')) {
        var t = (el.type || 'text').toLowerCase();
        if (['text', 'password', 'email', 'tel', 'number'].indexOf(t) !== -1) {
          el.removeAttribute('readonly');
        }
      }
    }

    var forms = root.querySelectorAll ? root.querySelectorAll('form') : [];
    for (var k = 0; k < forms.length; k++) {
      var fac = (forms[k].getAttribute('autocomplete') || '').toLowerCase();
      if (!fac || fac in BLOCKED_AC) forms[k].setAttribute('autocomplete', 'on');
    }
  }

  // ==================== OTP 聚焦 → 剪贴板自动填充 ====================
  function bindClipboardFill(input) {
    input.addEventListener('focus', function () {
      if (nativeGet.call(input)) return;
      if (!navigator.clipboard || !navigator.clipboard.readText) return;
      navigator.clipboard.readText().then(function (text) {
        text = (text || '').trim();
        if (DIGIT_RE.test(text)) {
          forceUpdate(input, text);
          console.log(TAG, '剪贴板自动填入', text.length + ' 位');
        }
      }).catch(function () {});
    });
  }

  // ==================== 监听外部填充（Bitwarden 等） ====================
  // 密码管理器填值后，框架可能重置。轮询捕获并用 forceUpdate 固定。
  function watchExternalFill(input) {
    var lastSeen = '';
    var tick = setInterval(function () {
      var cur = nativeGet.call(input);
      if (cur && cur !== lastSeen) {
        lastSeen = cur;
        forceUpdate(input, cur);
          console.log(TAG, '外部填充已固定', cur.length + ' 位');
      }
    }, 80);
    setTimeout(function () { clearInterval(tick); }, 120000);
  }

  // ==================== 启动 ====================
  unlock(document);

  var body = document.body || document.documentElement;
  if (body) {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) unlock(nodes[j]);
        }
      }
    }).observe(body, { childList: true, subtree: true });
  }

  console.log(TAG, 'ready', location.host);
})();
