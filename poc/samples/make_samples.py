"""시험용 예시 자료 만들기 (학생 정보 없는 가짜 내용).

필요: pip install python-pptx openpyxl
실행: python make_samples.py   (이 폴더에서)
만든 파일은 저장소에 함께 올라가 있으므로 보통은 다시 만들 필요가 없다.
한글 파일(.hwp/.hwpx)은 만들 수 없어서, 필요하면 내용 없는 예시 파일을 직접 넣는다.
"""
import unicodedata
from pathlib import Path

from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Pt

HERE = Path(__file__).resolve().parent


def nfc(name: str) -> str:
    # 맥에서 만들어도 파일 이름이 NFC로 저장되게 한다 (윈도우에서 깨지지 않게)
    return unicodedata.normalize("NFC", name)


def make_pptx() -> Path:
    prs = Presentation()
    slides = [
        ("1부. 생성형 AI 이해하기", ["생성형 AI란 무엇인가", "교실에서의 활용 장면", "주의할 점: 개인정보·저작권"]),
        ("수업 설계 활동", ["모둠별로 수업 장면 하나 고르기", "활동지에 단계별로 적기"]),
        ("정리", ["오늘 배운 것", "다음 시간 안내"]),
    ]
    for title, bullets in slides:
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = title
        body = s.placeholders[1].text_frame
        body.text = bullets[0]
        for b in bullets[1:]:
            p = body.add_paragraph()
            p.text = b
        for p in body.paragraphs:
            for r in p.runs:
                r.font.size = Pt(28)
    out = HERE / nfc("샘플_발표자료.pptx")
    prs.save(out)
    return out


def make_xlsx() -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "모둠"
    ws.append(["모둠", "이름 1", "이름 2", "이름 3", "이름 4"])
    for g in range(1, 7):
        ws.append([f"{g}모둠"] + [f"학생 {(g - 1) * 4 + k:02d}" for k in range(1, 5)])
    out = HERE / nfc("샘플_모둠편성.xlsx")
    wb.save(out)
    return out


if __name__ == "__main__":
    for f in (make_pptx(), make_xlsx()):
        print("만듦:", f.name)
