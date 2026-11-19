import test from 'node:test';
import assert from 'node:assert/strict';
import { rewrite, UI_FIELDS } from '../src/patcher.mjs';

const dict = {
  Cancel: '取消',
  'New Terminal': '新建终端',
  'Show more': '显示更多',
  Settings: '设置',
  Cursor: '光标',
  Agent: '智能体',
};

test('替换 UI 字段里的整句英文', () => {
  const src = 'x({label:"Cancel",title:"New Terminal",children:"Show more"})';
  const { text, hits } = rewrite(src, dict);
  assert.match(text, /label:"取消"/);
  assert.match(text, /title:"新建终端"/);
  assert.match(text, /children:"显示更多"/);
  assert.equal(hits.get('Cancel'), 1);
});

test('不替换子串匹配', () => {
  const src = 'x({label:"Cancel all",tooltip:"Cancel"})';
  const { text } = rewrite(src, dict);
  // "Cancel all" 不在词典里，只有作为完整值的 "Cancel" 被替换
  assert.match(text, /label:"Cancel all"/);
  assert.match(text, /tooltip:"取消"/);
});

test('不替换代码标识符与数据值', () => {
  const src = [
    'a({id:"Cancel"})',
    'b({name:"cancelAll"})',
    'c({label:"foo.bar.js"})',
    'd({label:"https://example.com"})',
    'e({label:"$(icon)"})',
    'f({label:"CONST_NAME"})',
  ].join(',');
  const { text } = rewrite(src, dict);
  assert.equal(text, src);
});

test('产品名保持原文', () => {
  const src = 'x({label:"Cursor"})';
  const { text } = rewrite(src, dict);
  assert.match(text, /label:"Cursor"/);
});

test('转义引号不会破坏语法', () => {
  const src = 'x({label:"He said \\"hi\\""})';
  const { text } = rewrite(src, { 'He said "hi"': '他说「你好」' });
  assert.doesNotThrow(() => new Function(text));
});

test('aria-label 与 kebab-case 字段', () => {
  const src = 'x({"aria-label":"Settings","ariaLabel":"Cancel"})';
  const { text } = rewrite(src, dict);
  assert.match(text, /"aria-label":"设置"/);
  assert.match(text, /"ariaLabel":"取消"/);
});

test('模式名整组替换', () => {
  const src = 'm({agent:"Agent",chat:"Chat",background:"Cloud",plan:"Plan",spec:"Spec",debug:"Debug",triage:"Triage"})';
  const { text } = rewrite(src, { ...dict, Chat: '聊天', Cloud: '云端', Plan: '计划' });
  assert.match(text, /chat:"聊天"/);
  assert.match(text, /background:"云端"/);
  assert.match(text, /debug:"Debug"/); // 词典里没有的不动
});

test('UI_FIELDS 覆盖 Cursor 常用字段', () => {
  for (const f of ['label', 'title', 'description', 'placeholder', 'ariaLabel', 'tooltip', 'children']) {
    assert.ok(UI_FIELDS.includes(f), f + ' 应在 UI_FIELDS 中');
  }
});
