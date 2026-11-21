// 자료 종류 판별과 파일 이름 규칙 (준비 화면·사이드바 공통)

export const EXT_TYPE = {
  ppt: 'pptx', pptx: 'pptx', key: 'file', xls: 'xlsx', xlsx: 'xlsx', csv: 'xlsx', hwp: 'hwp', hwpx: 'hwp', pdf: 'pdf',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', avi: 'video', mkv: 'video', wmv: 'video',
  jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', heic: 'img', svg: 'img', bmp: 'img',
  txt: 'memo', md: 'memo', html: 'web', htm: 'web', doc: 'file', docx: 'file',
};

/** 수업 폴더에 넣지 않는 실행 파일·스크립트 (기본 프로그램으로 열면 실행될 수 있음) */
export const BLOCKED = /\.(exe|bat|cmd|com|msi|app|command|sh|bash|zsh|ps1|psm1|vbs|vbe|wsf|hta|reg|cpl|jar|scr|dmg|pkg|pif|lnk|apk|py|pyw|pl|rb|scpt|workflow|terminal)$/i;

/** 시작 위치를 쓸 수 있는 종류와 예시 */
export const START_HINT = { youtube: '0:45', video: '1:20', pdf: '3쪽', pptx: '3번 슬라이드' };

export function extOf(name){
  const m = /\.([a-z0-9]+)$/i.exec(String(name));
  return m ? m[1].toLowerCase() : '';
}

export function typeOfFile(name){
  return EXT_TYPE[extOf(name)] ?? 'file';
}

const GUESS = { youtube: '유튜브 영상', gdoc: '구글 문서', gsheet: '구글 시트', gslides: '구글 슬라이드', gdrive: '드라이브 폴더', canva: '캔바 디자인' };

/** 붙여 넣은 링크의 종류 알아보기. 실패하면 { error } */
export function detectUrl(raw){
  const s = String(raw ?? '').trim();
  if (!s) return { error: '링크를 붙여 넣어 주세요' };
  if (/\s/.test(s)) return { error: '링크 주소 형식이 아닙니다' };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); }
  catch { return { error: '링크 주소 형식이 아닙니다' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'http/https 주소만 넣을 수 있습니다' };
  if (!u.hostname.includes('.')) return { error: '링크 주소 형식이 아닙니다' };
  const h = u.hostname.replace(/^(www\.|m\.)/, ''), p = u.pathname;
  let type = 'web';
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') type = 'youtube';
  else if (h === 'docs.google.com') type = p.startsWith('/spreadsheets') ? 'gsheet' : p.startsWith('/presentation') ? 'gslides' : p.startsWith('/document') ? 'gdoc' : 'web';
  else if (h === 'drive.google.com') type = 'gdrive';
  else if (h === 'canva.com' || h.endsWith('.canva.com')) type = 'canva';
  let start = '';
  if (type === 'youtube'){
    const t = parseInt(u.searchParams.get('t') ?? '', 10);
    if (t > 0) start = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  return { type, url: u.href, host: h, start, title: GUESS[type] ?? h };
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 윈도우·맥 어디서나 쓸 수 있는 파일·폴더 이름 조각.
 * NFC로 맞추고, 금지 문자·제어 문자를 빼고, 공백은 없애고(짧고 읽기 쉽게), 너무 길면 자른다.
 */
export function safeName(s, max = 40){
  let n = String(s ?? '').normalize('NFC')
    .replace(/\s*[:·]\s*/g, '_')
    .replace(/[\\/*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if ([...n].length > max) n = [...n].slice(0, max).join('');
  if (!n) n = '자료';
  if (RESERVED.test(n)) n = '_' + n;
  return n;
}

export const pad2 = n => String(n).padStart(2, '0');
