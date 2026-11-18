import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p, enc = 'utf8') => fs.readFileSync(new URL(`../${p}`, import.meta.url), enc);

test('Gaegu 서브셋이 UI 소스의 한글을 모두 담고 있음 (빠졌으면 npm run font)', () => {
  const covered = new Set(read('web/fonts/gaegu-chars.txt'));
  const missing = new Set();
  for (const f of ['web/index.html', 'web/main.js']) {
    for (const ch of read(f).match(/[가-힣]/g) ?? []) if (!covered.has(ch)) missing.add(ch);
  }
  assert.deepEqual([...missing], [], `서브셋에 없는 글자: ${[...missing].join('')} — npm run font 로 다시 만들 것`);
});

test('폰트 파일: woff2 형식, 크기 상한, 라이선스 동봉, CSS·HTML 연결', () => {
  const font = read('web/fonts/gaegu-700.woff2', null);
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(font.length < 150 * 1024, `폰트가 너무 큼: ${font.length} B`);
  assert.match(read('web/fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(read('web/fonts/OFL.txt'), /Gaegu Project Authors/);
  assert.match(read('web/style.css'), /url\(fonts\/gaegu-700\.woff2\)/);
  assert.match(read('web/index.html'), /rel="preload" href="fonts\/gaegu-700\.woff2"/);
});
