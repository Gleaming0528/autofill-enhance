// ==================== 自动填充增强 ====================
// ISOLATED world content script：独立 JS 上下文，天然绕过任何 CSP。
// 与页面共享 DOM 树，可安全修改属性、派发事件。
// HTMLInputElement.prototype 是浏览器原生实现，不被页面框架污染。

(function () {
  'use strict';

  var TAG = '[AutoFill]';
  var OTP_RE = /安全码|验证码|校验码|动态码|口令|otp|totp|mfa|2fa|security.?code|verif|one.?time|auth.?code|token/i;
  // 剪贴板自动填充仅匹配 6 位数字，避免误填 PIN / 年份；更长或更短的码走手动粘贴。
  var CLIP_RE = /^\d{6}$/;
  // new-password 是合法提示（注册页防误填），不在此拦截。
  var BLOCKED_AC = { off: 1, 'false': 1, nope: 1, disabled: 1 };
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

  // ==================== label 关联 ====================
  // 优先取 label[for=id] 精确绑定的文案；其次取最近一层具体 form-item 容器的 label。
  // 不使用 [class*="form"] 宽泛匹配，避免把同表单的手机号等字段误判为验证码。
  function labelFor(el) {
    if (el.id) {
      try {
        var esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
        var bound = el.ownerDocument.querySelector('label[for="' + esc + '"]');
        if (bound) return bound.textContent;
      } catch (e) {}
    }
    var WRAPPERS = ['.next-form-item', '.ant-form-item', '.form-group', '.form-item'];
    for (var i = 0; i < WRAPPERS.length; i++) {
      try {
        var item = el.closest(WRAPPERS[i]);
        if (!item) continue;
        var lab = item.querySelector('label');
        if (lab) return lab.textContent;
      } catch (e) {}
    }
    return '';
  }

  function isOtpField(el) {
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    if (['text', 'tel', 'number', 'password'].indexOf(t) === -1) return false;
    var hints = [
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('aria-label'),
      labelFor(el)
    ];
    return OTP_RE.test(hints.filter(Boolean).join(' '));
  }

  // 所在表单含密码框 → 视为登录/注册场景，允许解锁只读与粘贴。
  function inAuthForm(el) {
    try {
      var form = el.form || el.closest('form');
      return !!(form && form.querySelector('input[type="password"]'));
    } catch (e) {
      return false;
    }
  }

  // ==================== 粘贴拦截 ====================
  // 仅对验证码字段接管粘贴（整值替换符合输入完整 OTP 的语义）。
  // 普通输入框保留浏览器默认的「按光标插入」粘贴，避免清空已有内容。
  document.addEventListener('paste', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !otpFields.has(el)) return;
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
        console.log(TAG, 'OTP 字段:', el.placeholder || el.name || '(unknown)');
        bindClipboardFill(el);
        watchExternalFill(el);
      }

      // 只读 / 粘贴解锁只作用于验证码字段或登录表单，
      // 避免误伤日期选择器、只读金额展示等正常组件。
      if (otp || inAuthForm(el)) {
        el.removeAttribute('onpaste');
        if (el.tagName === 'INPUT' && el.hasAttribute('readonly')) {
          var t = (el.type || 'text').toLowerCase();
          if (['text', 'password', 'email', 'tel', 'number'].indexOf(t) !== -1) {
            el.removeAttribute('readonly');
          }
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
        if (CLIP_RE.test(text)) {
          forceUpdate(input, text);
          console.log(TAG, '剪贴板自动填入', text.length + ' 位');
        }
      }).catch(function () {});
    });
  }

  // ==================== 监听外部填充（Bitwarden 等） ====================
  // 密码管理器填值后，框架可能重置。轮询捕获并用 forceUpdate 固定。
  // 聚焦时视为用户正在键入，不重复派发事件；值稳定约 2 秒后停止该字段轮询。
  function watchExternalFill(input) {
    var lastSeen = '';
    var stable = 0;
    var tick = setInterval(function () {
      var cur = nativeGet.call(input);
      if (!cur) {
        stable = 0;
        return;
      }
      if (cur === lastSeen) {
        if (++stable >= 25) clearInterval(tick);
        return;
      }
      lastSeen = cur;
      stable = 0;
      if (document.activeElement === input) return;
      forceUpdate(input, cur);
      console.log(TAG, '外部填充已固定', cur.length + ' 位');
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
