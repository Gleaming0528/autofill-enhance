const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContentScript(input) {
  const listeners = {};

  class HTMLInputElement {
    constructor() {
      this._value = '';
      this.tagName = 'INPUT';
      this.type = 'text';
      this.placeholder = '验证码';
      this.ownerDocument = document;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.attributes = new Map();
    }

    get value() {
      return this._value;
    }

    set value(value) {
      this._value = value;
    }

    addEventListener() {}
    dispatchEvent() { return true; }
    closest() { return null; }
    getAttribute(name) { return this.attributes.get(name) || null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    setAttribute(name, value) { this.attributes.set(name, value); }
  }

  const document = {
    activeElement: null,
    body: {},
    addEventListener(type, listener) { listeners[type] = listener; },
    querySelectorAll(selector) {
      return selector === 'input, select, textarea' ? [input] : [];
    }
  };

  Object.setPrototypeOf(input, HTMLInputElement.prototype);
  input.ownerDocument = document;

  const context = {
    console: { log() {} },
    document,
    Event: class Event {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options && options.bubbles;
      }
    },
    HTMLInputElement,
    location: { host: 'example.test' },
    MutationObserver: class MutationObserver { observe() {} },
    navigator: {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() {},
    WeakSet,
    window: { CSS: { escape: value => value } }
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  vm.runInNewContext(source, context);
  return listeners;
}

test('在已有内容末尾粘贴时保留原内容', () => {
  const input = {
    _value: '12',
    tagName: 'INPUT',
    type: 'text',
    placeholder: '验证码',
    selectionStart: 2,
    selectionEnd: 2,
    attributes: new Map([['placeholder', '验证码']])
  };
  const listeners = loadContentScript(input);
  const event = {
    target: input,
    clipboardData: { getData: () => '34' },
    preventDefault() {},
    stopImmediatePropagation() {}
  };

  listeners.paste(event);

  assert.equal(input.value, '1234');
});
