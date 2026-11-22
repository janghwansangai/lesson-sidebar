// 설치판을 이 맥의 "LessonSidebar Signing" 인증서로 다시 서명한다 (키체인에 있을 때만, 없으면 임시 서명 그대로).
// 같은 인증서로 서명하면 새로 설치해도 맥이 같은 앱으로 보아 손쉬운 사용 권한이 남는다 (docs/poc/mac.md 35).
// 인증서는 선생님이 키체인 접근 → 인증서 지원 → 인증서 생성(자체 서명 루트, 코드 서명)으로 만든다. 신뢰 설정은 필요 없다.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function signLocal(ctx){
  if (ctx.electronPlatformName !== 'darwin') return;
  let out = '';
  try { out = execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }); } catch { return; }
  const m = out.match(/([0-9A-F]{40}) "LessonSidebar Signing"/);
  if (!m){ console.log('  • 서명 인증서 "LessonSidebar Signing"이 없어 임시 서명 그대로 둡니다'); return; }
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '-s', m[1], app], { stdio: 'inherit' });
  console.log('  • "LessonSidebar Signing" 인증서로 서명했습니다');
};
