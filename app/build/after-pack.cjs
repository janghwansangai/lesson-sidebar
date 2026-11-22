// 설치판 파일을 만든 뒤(서명 전)에 부른다 (package.json build.afterPack).
// ① 맥: 앱을 Node로 켜는 문(ELECTRON_RUN_AS_NODE)을 끈다. 다른 프로그램이 이 앱을 Node로 켜서 이 앱의 맥 권한
//    (손쉬운 사용·화면 기록)을 빌려 쓰지 못하게 (2026-11-22 보안 점검). 윈도우는 창 관리 도우미가 이 방식으로 돌아서 그대로.
//    NODE_OPTIONS·--inspect로 끼어드는 문은 두 OS 모두 build.electronFuses에서 끈다.
// ② CI 시험용으로 만들 때만(환경 변수 SIDEBAR_SMOKE_BUILD=1) resources에 test-mode 표시를 넣는다.
//    그 설치판만 시험 모드(SIDEBAR_DEBUG)를 받는다 — 선생님이 쓰는 설치판은 시험 모드·디버깅 주소를 받지 않는다 (main.js TEST_BUILD).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(ctx){
  const mac = ctx.electronPlatformName === 'darwin';
  const appPath = mac ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`) : ctx.appOutDir;
  const res = mac ? path.join(appPath, 'Contents', 'Resources') : path.join(ctx.appOutDir, 'resources');
  if (process.env.SIDEBAR_SMOKE_BUILD === '1'){
    fs.writeFileSync(path.join(res, 'test-mode'), 'CI 시험용 설치판 (시험 모드를 받음)\n');
    console.log('  • CI 시험용 설치판: test-mode 표시를 넣었습니다');
  }
  if (mac){
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    await flipFuses(appPath, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false });
    console.log('  • 맥: Node로 켜는 문(RunAsNode)을 껐습니다');
  }
};
