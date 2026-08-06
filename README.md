# 自动填充增强 (autofill-enhance)

让密码管理器能自动填充被网站阻止的 OTP / MFA 验证码字段的 Chrome 扩展。

## 解决的问题

很多登录页给验证码输入框设置 `autocomplete="off"`、`readonly`、禁用粘贴，导致 Bitwarden 等密码管理器和系统短信验证码自动填充全部失效。本扩展在页面加载后修复这些限制：

- **解锁 autocomplete**：把 `off` / `disabled` 等值改回 `on`，OTP 字段改为 `one-time-code`
- **移除 readonly / onpaste**：仅限 OTP 字段与含密码字段的登录表单，避免误伤日期选择器、只读展示框等正常组件
- **剪贴板自动填充**：OTP 字段聚焦时，若剪贴板中是 6 位纯数字则自动填入（收紧为 6 位以避免误填旧验证码、PIN、年份；其他位数可手动粘贴）
- **粘贴拦截兜底**：页面 JS 拦截粘贴事件时，由扩展直接接管写入；仅对 OTP 字段生效，普通输入框保留浏览器默认的光标插入式粘贴
- **固定外部填充**：密码管理器填值后若被前端框架重置，轮询捕获并用原生 setter 重新写入，兼容 React / Vue 受控组件；字段聚焦（用户在键入）时不干预，值稳定后自动停止该字段轮询
- **支持 iframe**：内嵌登录表单（SSO 等）同样生效

## 安装

1. 克隆或下载本仓库
2. 打开 `chrome://extensions/`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库目录

## 原理说明

Content script 运行在 `ISOLATED` world：独立 JS 上下文，不受页面 CSP 限制；与页面共享 DOM 树，可通过 `HTMLInputElement.prototype` 原生 setter 写值并派发 `input` / `change` 事件，触发 React / Vue 的状态更新链路。

## 隐私

- 全部逻辑在本地执行，无任何网络请求，不收集数据
- 读取剪贴板仅在 OTP 字段获得焦点且字段为空时发生一次，且只接受 6 位纯数字

## 已知限制

- `matches` 为全站点匹配；如需收敛可自行修改 `manifest.json`
- 个别页面在扩展运行后才注入输入框，已通过 MutationObserver 覆盖动态新增节点
