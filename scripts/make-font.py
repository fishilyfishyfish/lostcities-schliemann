#!/usr/bin/env python3
"""Gaegu Bold 서브셋(woff2) 생성.

UI 소스(web/index.html, web/main.js)에 나오는 한글 + ASCII + 몇 가지 기호만 남긴다.
라벨 문구를 바꾸면 이 스크립트를 다시 돌려야 한다 (test/font.test.js가 빠진 글자를 잡아낸다).

사용법: python3 scripts/make-font.py [원본 Gaegu-Bold.ttf 경로]
필요: pip install fonttools brotli
원본 경로를 안 주면 google/fonts 저장소에서 받는다. 라이선스는 SIL OFL 1.1 (web/fonts/OFL.txt).
"""
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/gaegu/Gaegu-Bold.ttf"
UI_FILES = ["web/index.html", "web/main.js"]
SYMBOLS = "−→·×±≈…%"  # 점수 미리보기 "(-40 → -32)", "· 손패 8장" 등
OUT_DIR = ROOT / "web" / "fonts"


def collect_chars() -> str:
    chars = {chr(c) for c in range(0x20, 0x7F)} | set(SYMBOLS)
    for rel in UI_FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        chars |= set(re.findall(r"[가-힣]", text))
    return "".join(sorted(chars))


def main() -> None:
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        src = Path(tempfile.mkdtemp()) / "Gaegu-Bold.ttf"
        print(f"download {SOURCE_URL}")
        urllib.request.urlretrieve(SOURCE_URL, src)

    chars = collect_chars()
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.hinting = False
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # 저작권·라이선스 정보 유지
    font = subset.load_font(str(src), options)
    subs = subset.Subsetter(options)
    subs.populate(text=chars)
    subs.subset(font)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "gaegu-700.woff2"
    subset.save_font(font, str(out), options)
    covered = "".join(sorted(chr(c) for c in font.getBestCmap() if chr(c) in chars))
    (OUT_DIR / "gaegu-chars.txt").write_text(covered + "\n", encoding="utf-8")
    hangul = len(re.findall(r"[가-힣]", covered))
    print(f"wrote {out.relative_to(ROOT)}: {out.stat().st_size / 1024:.1f} KB, {len(covered)} chars (한글 {hangul})")
    missing = [c for c in chars if c not in covered]
    if missing:
        print("원본에 없는 글자 (기본 글꼴로 대체됨):", "".join(missing))


if __name__ == "__main__":
    main()
