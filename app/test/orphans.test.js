// 남은 사이드바 조각 찾기: 부모가 launchd(1)인 도우미만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrphans } from '../src/core/orphans.js';

const PS = `
    1     0   0.0 /sbin/launchd
14463     1   4.2 /Applications/LessonSidebar.app/Contents/MacOS/LessonSidebar
14468 14463   0.1 /Applications/LessonSidebar.app/Contents/Frameworks/LessonSidebar Helper (Renderer).app/Contents/MacOS/LessonSidebar Helper (Renderer)
13872     1 877.0 /Volumes/수업 사이드바 0.1.0 5/LessonSidebar.app/Contents/Frameworks/LessonSidebar Helper (Renderer).app/Contents/MacOS/LessonSidebar Helper (Renderer)
13880     1   0.0 /Volumes/x/LessonSidebar.app/Contents/Frameworks/LessonSidebar Helper (GPU).app/Contents/MacOS/LessonSidebar Helper (GPU)
12184     1   7.2 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper
14473 14463   0.9 /Applications/LessonSidebar.app/Contents/Resources/winctl
`;

test('부모가 없어진 사이드바 도우미만 고른다 (본체·정상 도우미·다른 앱은 빼고)', () => {
  assert.deepEqual(findOrphans(PS), [{ pid: 13872, cpu: 877 }, { pid: 13880, cpu: 0 }]);
});

test('출력이 비거나 이상해도 빈 목록', () => {
  assert.deepEqual(findOrphans(''), []);
  assert.deepEqual(findOrphans(null), []);
  assert.deepEqual(findOrphans('아무 말'), []);
});
