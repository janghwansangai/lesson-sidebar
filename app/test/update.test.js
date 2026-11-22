// 새 버전 알림: 버전 비교, 이 PC에 맞는 설치 파일 고르기, 응답별 판단 (인터넷 없이 가짜 응답으로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, pickAsset, checkUpdate, isReleaseUrl } from '../src/core/update.js';

const DL = 'https://github.com/janghwansangai/lesson-sidebar/releases/download/v0.2.0/';
const assets = [
  { name: 'lesson-sidebar-0.2.0-mac-arm64.dmg', browser_download_url: DL + 'lesson-sidebar-0.2.0-mac-arm64.dmg', size: 120e6 },
  { name: 'lesson-sidebar-0.2.0-win-x64-portable.exe', browser_download_url: DL + 'lesson-sidebar-0.2.0-win-x64-portable.exe' },
  { name: 'lesson-sidebar-0.2.0-win-x64-setup.exe', browser_download_url: DL + 'lesson-sidebar-0.2.0-win-x64-setup.exe' },
  { name: 'lesson-sidebar-0.2.0-win-x64-setup.exe.blockmap', browser_download_url: DL + 'x.blockmap' },
  { name: 'evil.dmg', browser_download_url: 'https://evil.example/evil.dmg' },
];
const fake = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('버전 비교', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.2', '0.2.1'), -1);
  assert.equal(compareVersions('1.0.0-beta', '0.9.0'), 1);
});

test('이 PC에 맞는 설치 파일, 다른 사이트 주소는 고르지 않는다', () => {
  assert.match(pickAsset(assets, 'darwin', 'arm64').name, /mac-arm64\.dmg$/);
  assert.match(pickAsset(assets, 'win32', 'x64', false).name, /setup\.exe$/);
  assert.match(pickAsset(assets, 'win32', 'x64', true).name, /portable\.exe$/);
  assert.equal(pickAsset([assets[4]], 'darwin', 'arm64'), null);
  assert.equal(pickAsset(assets, 'linux', 'x64'), null);
});

test('새 버전이면 내려받을 주소, 같거나 없거나 미리보기판이면 null', async () => {
  const rel = { tag_name: 'v0.2.0', html_url: 'https://github.com/janghwansangai/lesson-sidebar/releases/tag/v0.2.0', body: '발표자 화면', assets };
  const u = await checkUpdate('0.1.0', { fetchFn: fake(200, rel), platform: 'darwin', arch: 'arm64' });
  assert.equal(u.version, '0.2.0'); assert.match(u.url, /mac-arm64\.dmg$/); assert.equal(u.notes, '발표자 화면');
  assert.equal(u.sha256, null);   // 지문이 없으면 크기만 확인
  const dg = 'sha256:' + 'Ab'.repeat(32);
  const withDigest = await checkUpdate('0.1.0', { fetchFn: fake(200, { ...rel, assets: assets.map(a => ({ ...a, digest: dg })) }), platform: 'darwin', arch: 'arm64' });
  assert.equal(withDigest.sha256, 'ab'.repeat(32));
  const badDigest = await checkUpdate('0.1.0', { fetchFn: fake(200, { ...rel, assets: assets.map(a => ({ ...a, digest: 'md5:xyz' })) }), platform: 'darwin', arch: 'arm64' });
  assert.equal(badDigest.sha256, null);
  assert.equal(await checkUpdate('0.2.0', { fetchFn: fake(200, rel) }), null);
  assert.equal(await checkUpdate('0.1.0', { fetchFn: fake(404, {}) }), null);
  assert.equal(await checkUpdate('0.1.0', { fetchFn: fake(200, { ...rel, prerelease: true }) }), null);
  await assert.rejects(checkUpdate('0.1.0', { fetchFn: fake(503, {}) }), /HTTP 503/);
  // 맞는 파일이 없으면 Releases 페이지로
  const nofile = await checkUpdate('0.1.0', { fetchFn: fake(200, { ...rel, assets: [] }), platform: 'darwin', arch: 'arm64' });
  assert.equal(nofile.url, rel.html_url);
  assert.ok(isReleaseUrl(u.url) && isReleaseUrl(rel.html_url) && !isReleaseUrl('https://evil.example/'));
});
