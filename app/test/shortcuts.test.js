// 단축키: 클리커 키·화살표와 겹치지 않고, 부르는 기능이 사이드바에 있는 것만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHORTCUTS, accelerator, keyLabel, WINDOW_TOOL_KEYS } from '../src/core/shortcuts.js';

test('단축키는 Ctrl+Alt+글자 하나, 서로 겹치지 않고, 맥·윈도우 표시가 다르다', () => {
  const keys = SHORTCUTS.map(s => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of SHORTCUTS){
    assert.match(s.key, /^[A-Z]$/);
    assert.equal(accelerator(s), `Control+Alt+${s.key}`);
  }
  assert.equal(keyLabel(SHORTCUTS[0], 'darwin'), '⌃⌥N');
  assert.equal(keyLabel(SHORTCUTS[0], 'win32'), 'Ctrl+Alt+N');
});

test('맥 창 배치 프로그램(Rectangle·Magnet) 기본 단축키와 겹치지 않는다', () => {
  for (const s of SHORTCUTS) assert.ok(!WINDOW_TOOL_KEYS.includes(s.key), `${s.label} ⌃⌥${s.key}`);
  assert.deepEqual(SHORTCUTS.filter(s => ['blank', 'freeze'].includes(s.act)).map(s => s.key), ['H', 'M']);
});

test('단축키가 부르는 기능은 모두 메인의 ACTIONS에 있다', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const block = main.slice(main.indexOf('const ACTIONS = {'), main.indexOf('\n};', main.indexOf('const ACTIONS = {')));
  for (const s of SHORTCUTS) assert.match(block, new RegExp(`\\n  ${s.act}: `), s.act);
});
