/* Cursor 中文界面运行时（DOM 静态词典翻译 + 动态文本样式）
 * 由 apply.mjs 注入到 workbench.html；只翻译界面文案，不触碰编辑器/终端/对话内容。
 */
(function () {
  'use strict';
  if (window.__cursorZhRuntime) return;
  window.__cursorZhRuntime = true;

  var DICT = window.__CURSOR_ZH_DICT || {};
  var PATTERNS = window.__CURSOR_ZH_PATTERNS || [];

  // 明确不翻译的区域：代码编辑器、终端、输入框内容、对话/模型输出、diff
  var SKIP_SELECTOR = [
    '.monaco-editor', '.monaco-diff-editor', '.xterm', '.terminal-outer-container',
    '.composer-message', '.chat-message', '.agent-message', '.markdown-body',
    'textarea', 'pre', 'code', '.view-lines', '.output', '.suggest-widget',
    '.quick-input-widget .quick-input-list .monaco-list-row .label-name',
    '[contenteditable="true"]'
  ].join(',');

  // 允许翻译的属性
  var ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'data-tooltip'];

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, KBD: 1, svg: 1 };
  var SKIP_TAGS_UPPER = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, KBD: 1 };

  function skipElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (SKIP_TAGS_UPPER[el.tagName]) return true;
    try {
      if (el.closest && el.closest(SKIP_SELECTOR)) return true;
    } catch (e) {}
    return false;
  }

  var MAX_LEN = 220;

  // 空态提示条容器：整句文案被拆成多个内联 span（含 /命令 chip）
  var TIP_SEL = '[data-component="glass-empty-state-rotating-tips"] .ui-text,' +
    ' [data-component*="rotating-tips"] .ui-text,' +
    ' [data-component="glass-empty-state-onboarding-footer"] .ui-text,' +
    ' .glass-empty-state-rotating-tips .ui-text,' +
    ' [data-component*="empty-state"] .ui-text';

  function translateText(raw) {
    if (typeof raw !== 'string') return null;
    var text = raw;
    var lead = '';
    var tail = '';
    var m = /^([\s\u00a0]*)([\s\S]*?)([\s\u00a0]*)$/.exec(text);
    if (m) { lead = m[1]; text = m[2]; tail = m[3]; }
    if (!text || text.length > MAX_LEN) return null;
    // 有些容器里同一句话出现两份（一份用于布局测量），取第一行/去重后再匹配
    if (text.indexOf('\n') >= 0) {
      var parts = text.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      for (var pi = 0; pi < parts.length; pi++) {
        var sub = DICT[parts[pi]];
        if (typeof sub === 'string' && sub) return lead + sub + tail;
      }
      return null;
    }
    if (!/[A-Za-z]{2}/.test(text)) return null;
    if (/[\u4e00-\u9fff]/.test(text)) return null;
    if (text.indexOf('http://') >= 0 || text.indexOf('https://') >= 0) return null;
    // 代码/路径/标识符样式的内容不翻
    if (/^[$._a-zA-Z0-9/\\:-]+\.[a-z0-9]{1,6}$/i.test(text) && /\//.test(text)) return null;
    if (/^[a-zA-Z0-9_.\-]+$/.test(text) && text.length > 18) return null;

    // dedupe repeated copy：提示条为了测量宽度会渲染两份相同文本（可能带空格分隔）
    var dedupeHit = null;
    var trimmed = text.replace(/[ ]+$/, "");
    var halfLen = Math.floor(trimmed.length / 2);
    for (var off = 0; off <= 2 && !dedupeHit; off++) {
      var half = trimmed.slice(0, halfLen - off).trim();
      if (!half) break;
      var rest = trimmed.slice(halfLen - off).trim();
      if (half === rest) {
        var hv = DICT[half];
        if (typeof hv === "string" && hv) dedupeHit = hv;
      }
    }
    if (dedupeHit) return lead + dedupeHit + tail;
    var hit = DICT[text];
    if (typeof hit === 'string' && hit) return lead + hit + tail;

    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      try {
        if (p.re.test(text)) {
          p.re.lastIndex = 0;
          var out = text.replace(p.re, p.zh);
          if (out !== text) return lead + out + tail;
        }
        p.re.lastIndex = 0;
      } catch (e) { p.re.lastIndex = 0; }
    }
    return null;
  }

  function inTipContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    try { return !!el.closest("[data-component*=\"rotating-tips\"], .glass-empty-state-rotating-tips"); } catch (e) { return false; }
  }

  function handleTextNode(node) {
    var parent = node.parentElement;
    if (!parent || skipElement(parent)) return;
    if (inTipContainer(parent)) return;
    var t = node.nodeValue;
    if (!t) return;
    var out = translateText(t);
    if (out !== null && out !== t) node.nodeValue = out;
  }

  function handleAttributes(el) {
    if (!el || el.nodeType !== 1) return;
    if (skipElement(el)) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // 输入框自身跳过，但其 placeholder 需要翻译
    }
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(name);
      if (!v) continue;
      if (el.tagName === 'INPUT' && name !== 'placeholder' && name !== 'title' && name !== 'aria-label') continue;
      var out = translateText(v);
      if (out !== null && out !== v) {
        try { el.setAttribute(name, out); } catch (e) {}
      }
    }
  }

  // 组合文本翻译：Cursor 的提示条把一句话拆成多个内联 span（如 Use <chip>/review</chip> ...），
  // 逐文本节点无法整句匹配，这里对"仅含内联子元素"的容器做整段替换。
  function composedTranslate(el) {
    if (!el || el.nodeType !== 1) return false;
    var text = (el.textContent || "").replace(/[ \t\n\r]+/g, " ").trim();
    if (!text || text.length > MAX_LEN) return false;
    var hit = translateText(text);
    if (hit === null) return false;
    var probe = null;
    try { probe = el.closest("[data-component*=\"rotating-tips\"], [data-component*=\"empty-state\"], .glass-empty-state-onboarding-footer"); } catch (e) { return false; }
    if (!probe) return false;
    // 只改文本节点的值，保留内部 span（chip/图标），避免与 React 的虚拟 DOM 冲突
    var nodes = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    if (!nodes.length) return false;
    var full = "";
    for (var i = 0; i < nodes.length; i++) full += nodes[i].nodeValue;
    if (full === hit) return false;
    nodes[0].nodeValue = hit;
    for (var j = 1; j < nodes.length; j++) nodes[j].nodeValue = "";
    return true;
  }

  function walkComposed(root) {
    if (!root || root.nodeType !== 1) return;
    var nodes = [];
    try {
      if (root.matches && root.matches(TIP_SEL)) nodes.push(root);
      var found = root.querySelectorAll(TIP_SEL);
      for (var i = 0; i < found.length; i++) nodes.push(found[i]);
    } catch (e) { return; }
    for (var j = 0; j < nodes.length; j++) {
      try { composedTranslate(nodes[j]); } catch (e) {}
    }
    // 兜底：容器自身（无 .ui-text 包裹时）
    try {
      var boxes = root.querySelectorAll('[data-component="glass-empty-state-rotating-tips"], [data-component*="rotating-tips"]');
      for (var k = 0; k < boxes.length; k++) composedTranslate(boxes[k]);
    } catch (e) {}
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 1) walkComposed(root);
    if (root.nodeType === 3) { handleTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (skipElement(root)) return;
    handleAttributes(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && skipElement(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) handleTextNode(n);
      else handleAttributes(n);
    }
  }

  var pending = new Set();
  var scheduled = false;
  function schedule(node) {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      var items = Array.from(pending);
      pending.clear();
      for (var i = 0; i < items.length; i++) {
        try { walk(items[i]); } catch (e) {}
      }
    });
  }

  var mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') { schedule(r.target.parentNode || r.target); continue; }
      if (r.type === 'attributes') { schedule(r.target); continue; }
      for (var j = 0; j < r.addedNodes.length; j++) schedule(r.addedNodes[j]);
    }
  });

  function start() {
    walk(document.body);
    mo.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ATTRS
    });
    // 提示条轮换由 React 重渲染驱动，会覆盖已翻译的文本；定时重扫保证始终是中文
    var tipsSweep = setInterval(function () {
      try { walkComposed(document.body); } catch (e) {}
    }, 1200);
    window.addEventListener("pagehide", function () { clearInterval(tipsSweep); }, { once: true });

    // 初次加载后有几个延迟渲染阶段，重复扫几遍兜底
    [400, 1200, 3000, 6000].forEach(function (ms) {
      setTimeout(function () { try { walk(document.body); } catch (e) {} }, ms);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
