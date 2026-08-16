# -*- coding: utf-8 -*-
"""Dung file Excel nhap lieu 25 mat hang can tao tren web parislinhdam.

Ma de xuat bam theo quy tac tien to dang dung o chi nhanh do:
  10xxxxx DOKHO | 11xxxxx BIA-NUOC NGOT | 13xxxxx RUOU-VANG
  14xxxxx THUOCLA-SHISA-XIGA | 15xxxxx HOAQUA | 16xxxxx DOPHACHE
"""
import json
import re
import zipfile
from xml.sax.saxutils import escape

OUT = "MatHang_Can_Tao_ParisLinhDam.xlsx"

# (stockCode, ten kho, gia ban, don vi, nhom, nhom_ky_tu, ghi chu)
ITEMS = [
    # --- Nhom A: web LD dang gop nhieu quy cach, phai tach rieng de hach toan ---
    ("DECUOI60", "Hạt dẻ cười 60 gram", 65000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000010 HẠT DẺ cho 3 quy cách"),
    ("DECUOI70", "Hạt dẻ cười 70 gram", 65000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000010 HẠT DẺ cho 3 quy cách"),
    ("HATDECUOIRM", "Hạt dẻ cười rang muối", 40000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000010 HẠT DẺ cho 3 quy cách"),
    ("QUYTRAXANH", "BÁNH QUY QUE VỊ TRÀ XANH 36G (CHOCO007)", 40000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000001 Bánh quy que cho 2 vị"),
    ("QUYVIETQUAT", "BÁNH QUY QUE VỊ VIỆT QUẤT 36G (CHOCO008)", 40000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000001 Bánh quy que cho 2 vị"),
    ("BANHPEANUT45G", "Bánh xốp Loacker Classic Peanut Butter 45g", 60000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000039 Bánh xốp classic 45g"),
    ("BANH XOP", "Bánh xốp classic 45g", 60000, "gói", "DOKHO", "10",
     "A - Web đang gộp chung mã 1000039 Bánh xốp classic 45g"),

    # --- Nhom B: ten khac nhau, doi chieu truoc khi tao ---
    ("TLTHANGLONGTH", "Thuốc lá điếu Thăng Long hộp thiếc", 80000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chỉ có THUỐC LÁ 555 / VIP / SHISA, không có dòng Thăng Long"),
    ("TLĐTL", "Thuốc lá điếu Thăng Long", 50000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chưa có dòng Thăng Long"),
    ("TLBM", "Thăng Long B.M", 50000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chưa có dòng Thăng Long"),
    ("TLBC", "Thăng Long B.C", 50000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chưa có dòng Thăng Long"),
    ("TLDSLIM", "Thuốc lá điếu Thăng Long Slim", 50000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chưa có dòng Thăng Long"),
    ("TLSLIM", "Thăng Long Slim bao cứng", 50000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "B - Web LD chưa có dòng Thăng Long"),
    ("LAVIE500TH", "Lavie 500ml", 25000, "chai", "BIA - NƯỚC NGỌT", "11",
     "B - Web LD có 1100023 Nước suối Lavie 350ml, khác dung tích"),
    ("NUOCOFAN350", "Nước ION kiềm OFAN 350ml (Thùng 24 chai)", 15000, "chai", "BIA - NƯỚC NGỌT", "11",
     "B - Web LD có IONVie 350ml/500ml, khác nhãn OFAN"),
    ("YENSANESTTH", "Nước yến Sanest lon T x 190ml", 30000, "lon", "BIA - NƯỚC NGỌT", "11",
     "B - Web LD có 1100012 NƯỚC YẾN LON, cần xác nhận có phải Sanest không"),
    ("tratac", "Trà tắc mật ong (Nhãn hiệu Cozy) (Tết 320ml)", 40000, "chai", "BIA - NƯỚC NGỌT", "11",
     "B - Web LD có 1100035 Trà đào sả Cozy 320ml, khác vị"),
    ("BIM2PM", "Lay's Wavy vị Phô Mai Cheddar 28g", 15000, "gói", "DOKHO", "10",
     "B - Web LD có 1000031 Bim bim khoai tây Lay's, cần xác nhận vị"),
    ("BIM2VIMUOI", "Lay's Wavy vị muối nguyên bản 30g", 15000, "gói", "DOKHO", "10",
     "B - Web LD có 1000056 Bim bim Lay's, cần xác nhận vị"),
    ("BANHYAN2coc", "Bánh Yan Yan 44gr, 50gr", 30000, "gói", "DOKHO", "10",
     "B - Web LD có 1000052 Bánh Yan Yan, cần xác nhận quy cách"),
    ("Hạt macadamia", "Hạt macadamia chưa tách vỏ, đã qua chế biến (DO TQSX)", 65000, "gói", "DOKHO", "10",
     "B - Web LD chưa có macadamia, chỉ có hạt dẻ / hạt điều"),

    # --- Nhom C: chac chan chua co tren web LD ---
    ("Hotdog Ponnie", "Hotdog Ponnie giòn ăn liền vị cay 4hộp x 20gói x 28gr", 15000, "gói", "DOKHO", "10",
     "C - Không tìm thấy mặt hàng tương tự trên web LD"),
    ("saubaotu", "Sấu bao tử 100g", 70000, "gói", "DOKHO", "10",
     "C - Không tìm thấy mặt hàng tương tự trên web LD"),
    ("TLĐCCC", "Thuốc lá điếu đầu lọc Camel Compact Caster", 60000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "C - Web LD chưa có dòng Camel"),
    ("CAMELBT", "Thuốc lá điếu đầu lọc Camel Caster Black Tea", 80000, "bao", "THUOCLA - SHISA - XIGA", "14",
     "C - Web LD chưa có dòng Camel"),
]

# Ma lon nhat dang dung theo tung tien to o parislinhdam.
NEXT_CODE = {"10": 1000060, "11": 1100035, "13": 1300013, "14": 1400009, "15": 1500009, "16": 1600009}


def assign_codes(items):
    counters = dict(NEXT_CODE)
    out = []
    for stock_code, name, price, unit, group, prefix, note in items:
        counters[prefix] += 1
        out.append({
            "webCode": str(counters[prefix]),
            "stockCode": stock_code,
            "name": name,
            "unit": unit,
            "price": price,
            "group": group,
            "type": "Mặt hàng kiêm vật tư",
            "note": note,
        })
    return out


HEADERS = [
    "Mã hàng (đề xuất)", "Tên mặt hàng", "Đơn vị tính", "Giá bán",
    "Nhóm mặt hàng", "Loại mặt hàng", "Mã kho (đối chiếu)", "Ghi chú",
]
WIDTHS = [16, 46, 12, 12, 26, 22, 18, 62]


def col_letter(idx):
    letters = ""
    while idx >= 0:
        letters = chr(65 + idx % 26) + letters
        idx = idx // 26 - 1
    return letters


def build():
    rows = assign_codes(ITEMS)
    strings, index = [], {}

    def sid(text):
        if text not in index:
            index[text] = len(strings)
            strings.append(text)
        return index[text]

    sheet = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
             '<cols>']
    for i, width in enumerate(WIDTHS):
        sheet.append(f'<col min="{i+1}" max="{i+1}" width="{width}" customWidth="1"/>')
    sheet.append("</cols><sheetData>")

    # Hang tieu de
    cells = "".join(
        f'<c r="{col_letter(i)}1" t="s" s="1"><v>{sid(h)}</v></c>' for i, h in enumerate(HEADERS)
    )
    sheet.append(f'<row r="1" ht="26" customHeight="1">{cells}</row>')

    for n, row in enumerate(rows, start=2):
        values = [
            ("s", row["webCode"]), ("s", row["name"]), ("s", row["unit"]),
            ("n", row["price"]), ("s", row["group"]), ("s", row["type"]),
            ("s", row["stockCode"]), ("s", row["note"]),
        ]
        cells = ""
        for i, (kind, value) in enumerate(values):
            ref = f"{col_letter(i)}{n}"
            if kind == "n":
                cells += f'<c r="{ref}" s="3"><v>{value}</v></c>'
            else:
                cells += f'<c r="{ref}" t="s" s="2"><v>{sid(str(value))}</v></c>'
        sheet.append(f'<row r="{n}">{cells}</row>')

    sheet.append("</sheetData></worksheet>")
    sheet_xml = "".join(sheet)

    shared = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
              f'count="{len(strings)}" uniqueCount="{len(strings)}">'
              + "".join(f"<si><t xml:space=\"preserve\">{escape(s)}</t></si>" for s in strings)
              + "</sst>")

    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
              '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
              '<fills count="3"><fill><patternFill patternType="none"/></fill>'
              '<fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/>'
              '<bgColor indexed="64"/></patternFill></fill></fills>'
              '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
              '<border><left style="thin"><color rgb="FFBFBFBF"/></left>'
              '<right style="thin"><color rgb="FFBFBFBF"/></right>'
              '<top style="thin"><color rgb="FFBFBFBF"/></top>'
              '<bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="4">'
              '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" '
              'applyFill="1" applyBorder="1" applyAlignment="1">'
              '<alignment vertical="center" wrapText="1"/></xf>'
              '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" '
              'applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
              '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" '
              'applyBorder="1"/>'
              '</cellXfs><cellStyles count="1">'
              '<cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                   '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets><sheet name="Mat hang can tao" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                   '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
                   '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        z.writestr("xl/sharedStrings.xml", shared)
        z.writestr("xl/styles.xml", styles)

    return rows


if __name__ == "__main__":
    created = build()
    print(f"Da tao {OUT} voi {len(created)} mat hang")
    with open("mat-hang-can-tao-LD.json", "w", encoding="utf-8") as fh:
        json.dump(created, fh, ensure_ascii=False, indent=1)
    for row in created:
        print(f"  {row['webCode']}  {row['name'][:44]:<44} {row['price']:>8,}  {row['unit']}")
