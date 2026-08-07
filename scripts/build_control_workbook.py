import json
import math
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "Kiem_soat_chuan_hoa_Kho_Web.xlsx"


def load_embedded_json(path: Path, marker: str):
    text = path.read_text(encoding="utf-8")
    start = text.index(marker) + len(marker)
    return json.JSONDecoder().raw_decode(text[start:].lstrip())[0]


inventory_payload = load_embedded_json(ROOT / "inventory-data.js", "root.InvoiceInventoryData =")
web_payload = load_embedded_json(ROOT / "web-catalog.js", "root.InvoiceWebCatalog =")
inventory = inventory_payload["mappings"]
catalog = web_payload["items"]


def clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return 0
    return value


def col_name(index):
    result = ""
    while index:
        index, rem = divmod(index - 1, 26)
        result = chr(65 + rem) + result
    return result


def cell_ref(row, col):
    return f"{col_name(col)}{row}"


def xml_text(value):
    return escape(str(value), {'"': "&quot;"})


STYLE = {
    "default": 0,
    "title": 1,
    "subtitle": 2,
    "header": 3,
    "text": 4,
    "integer": 5,
    "decimal": 6,
    "money": 7,
    "percent": 8,
    "confirmed": 9,
    "review": 10,
    "unmatched": 11,
    "note": 12,
    "kpi_label": 13,
    "kpi_value": 14,
    "ok": 15,
    "warning": 16,
    "error": 17,
}


def xlsx_cell(row, col, value, style="default", formula=None, cached=None):
    ref = cell_ref(row, col)
    style_id = STYLE.get(style, 0)
    if formula is not None:
        cached_value = "" if cached is None else clean(cached)
        return f'<c r="{ref}" s="{style_id}"><f>{xml_text(formula)}</f><v>{cached_value}</v></c>'
    value = clean(value)
    if isinstance(value, bool):
        return f'<c r="{ref}" s="{style_id}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}" s="{style_id}"><v>{value}</v></c>'
    text = xml_text(value)
    preserve = ' xml:space="preserve"' if str(value).startswith(" ") or str(value).endswith(" ") else ""
    return f'<c r="{ref}" s="{style_id}" t="inlineStr"><is><t{preserve}>{text}</t></is></c>'


def sheet_xml(rows, widths, freeze_row=4, auto_filter=None, merges=None, validations=None, hidden_cols=None):
    row_parts = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        height = row.get("_height")
        for col_index, item in enumerate(row["cells"], start=1):
            if isinstance(item, dict):
                cells.append(xlsx_cell(
                    row_index,
                    col_index,
                    item.get("value", ""),
                    item.get("style", "default"),
                    item.get("formula"),
                    item.get("cached"),
                ))
            else:
                cells.append(xlsx_cell(row_index, col_index, item))
        height_attr = f' ht="{height}" customHeight="1"' if height else ""
        row_parts.append(f'<row r="{row_index}"{height_attr}>{"".join(cells)}</row>')

    cols = []
    hidden_cols = set(hidden_cols or [])
    for index, width in enumerate(widths, start=1):
        hidden = ' hidden="1"' if index in hidden_cols else ""
        cols.append(f'<col min="{index}" max="{index}" width="{width}" customWidth="1"{hidden}/>')

    pane = ""
    if freeze_row:
        pane = f'<pane ySplit="{freeze_row}" topLeftCell="A{freeze_row + 1}" activePane="bottomLeft" state="frozen"/>'

    merge_xml = ""
    if merges:
        merge_xml = f'<mergeCells count="{len(merges)}">' + "".join(f'<mergeCell ref="{item}"/>' for item in merges) + "</mergeCells>"

    filter_xml = f'<autoFilter ref="{auto_filter}"/>' if auto_filter else ""
    validation_xml = ""
    if validations:
        parts = []
        for sqref, formula in validations:
            parts.append(
                f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" '
                f'errorTitle="Giá trị không hợp lệ" error="Hãy chọn một giá trị trong danh sách." sqref="{sqref}">'
                f'<formula1>{xml_text(formula)}</formula1></dataValidation>'
            )
        validation_xml = f'<dataValidations count="{len(parts)}">{"".join(parts)}</dataValidations>'

    max_col = max((len(row["cells"]) for row in rows), default=1)
    dimension = f"A1:{cell_ref(len(rows), max_col)}"
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{dimension}"/>'
        '<sheetViews><sheetView showGridLines="0" workbookViewId="0">'
        f'{pane}<selection pane="bottomLeft" activeCell="A{freeze_row + 1}" sqref="A{freeze_row + 1}"/>'
        '</sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="18"/>'
        f'<cols>{"".join(cols)}</cols>'
        f'<sheetData>{"".join(row_parts)}</sheetData>'
        f'{filter_xml}{merge_xml}{validation_xml}'
        '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'
        '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
        '</worksheet>'
    )


def status_style(status):
    return {"confirmed": "confirmed", "review": "review", "unmatched": "unmatched"}.get(status, "text")


def control_issue(item):
    issues = []
    if item.get("status") != "confirmed":
        issues.append("Ánh xạ chưa được xác nhận")
    if not item.get("webCode"):
        issues.append("Thiếu mã web")
    if float(item.get("availableQty") or 0) <= 0:
        issues.append("Hết tồn khả dụng")
    if float(item.get("webPrice") or 0) <= 0:
        issues.append("Giá web không hợp lệ")
    if float(item.get("salePrice") or 0) != float(item.get("webPrice") or 0):
        issues.append("Giá kho và giá web khác nhau")
    return "; ".join(issues) or "Đủ điều kiện"


web_code_counts = {}
for item in inventory:
    code = str(item.get("webCode") or "")
    if code:
        web_code_counts[code] = web_code_counts.get(code, 0) + 1

confirmed_count = sum(item.get("status") == "confirmed" for item in inventory)
review_count = sum(item.get("status") == "review" for item in inventory)
unmatched_count = sum(item.get("status") == "unmatched" for item in inventory)
sellable_count = sum(
    item.get("status") == "confirmed"
    and float(item.get("availableQty") or 0) > 0
    and bool(item.get("webCode"))
    and float(item.get("webPrice") or 0) > 0
    for item in inventory
)
duplicate_mapping_count = sum(count > 1 for count in web_code_counts.values())
price_diff_count = sum(float(item.get("salePrice") or 0) != float(item.get("webPrice") or 0) for item in inventory)


summary_rows = [
    {"_height": 34, "cells": [{"value": "KIỂM SOÁT CHUẨN HÓA DỮ LIỆU KHO ↔ DANH MỤC WEB", "style": "title"}] + [""] * 7},
    {"_height": 24, "cells": [{"value": "Nguồn: KhoT5.xlsx + data.xlsx | Đồng bộ với dữ liệu extension hiện tại", "style": "subtitle"}] + [""] * 7},
    {"cells": [""] * 8},
    {"cells": [
        {"value": "TỔNG MÃ KHO", "style": "kpi_label"}, "",
        {"value": "ĐÃ XÁC NHẬN", "style": "kpi_label"}, "",
        {"value": "CẦN DUYỆT", "style": "kpi_label"}, "",
        {"value": "CHƯA KHỚP", "style": "kpi_label"}, "",
    ]},
    {"_height": 30, "cells": [
        {"value": "", "style": "kpi_value", "formula": "COUNTA('Anh_xa_Kho_Web'!$B$5:$B$57)", "cached": len(inventory)}, "",
        {"value": "", "style": "kpi_value", "formula": 'COUNTIF(\'Anh_xa_Kho_Web\'!$N$5:$N$57,"confirmed")', "cached": confirmed_count}, "",
        {"value": "", "style": "kpi_value", "formula": 'COUNTIF(\'Anh_xa_Kho_Web\'!$N$5:$N$57,"review")', "cached": review_count}, "",
        {"value": "", "style": "kpi_value", "formula": 'COUNTIF(\'Anh_xa_Kho_Web\'!$N$5:$N$57,"unmatched")', "cached": unmatched_count}, "",
    ]},
    {"cells": [""] * 8},
    {"cells": [
        {"value": "ĐỦ ĐIỀU KIỆN BÁN", "style": "kpi_label"}, "",
        {"value": "MÃ WEB BỊ DÙNG CHUNG", "style": "kpi_label"}, "",
        {"value": "CHÊNH GIÁ KHO/WEB", "style": "kpi_label"}, "",
        {"value": "TỔNG MÃ WEB", "style": "kpi_label"}, "",
    ]},
    {"_height": 30, "cells": [
        {"value": "", "style": "kpi_value", "formula": 'COUNTIF(\'Anh_xa_Kho_Web\'!$P$5:$P$57,"Đủ điều kiện")', "cached": sellable_count}, "",
        {"value": duplicate_mapping_count, "style": "kpi_value"}, "",
        {"value": "", "style": "kpi_value", "formula": 'COUNTIF(\'Anh_xa_Kho_Web\'!$M$5:$M$57,"<>0")', "cached": price_diff_count}, "",
        {"value": "", "style": "kpi_value", "formula": "COUNTA('Danh_muc_Web'!$B$5:$B$147)", "cached": len(catalog)}, "",
    ]},
    {"cells": [""] * 8},
    {"cells": [{"value": "Trạng thái", "style": "header"}, {"value": "Số lượng", "style": "header"}, {"value": "Ý nghĩa kiểm soát", "style": "header"}] + [""] * 5},
    {"cells": [{"value": "confirmed", "style": "confirmed"}, {"value": confirmed_count, "style": "integer"}, {"value": "Được đưa vào bộ giải nếu còn tồn và dữ liệu web hợp lệ", "style": "text"}] + [""] * 5},
    {"cells": [{"value": "review", "style": "review"}, {"value": review_count, "style": "integer"}, {"value": "Cần kế toán xác nhận lại mã/tên/giá trước khi dùng", "style": "text"}] + [""] * 5},
    {"cells": [{"value": "unmatched", "style": "unmatched"}, {"value": unmatched_count, "style": "integer"}, {"value": "Không được phép đưa vào hóa đơn", "style": "text"}] + [""] * 5},
    {"cells": [""] * 8},
    {"cells": [{"value": "Quy trình sử dụng", "style": "header"}] + [""] * 7},
    {"cells": [{"value": "1. Lọc sheet Cần_xử_lý → kiểm tra các dòng đỏ/vàng.  2. Cập nhật cột Quyết định kiểm soát và ghi chú tại sheet Ánh_xạ_Kho_Web.  3. Chỉ xác nhận khi mã web, tên, đơn vị, giá và tồn đều hợp lệ.  4. Dùng file đã rà soát làm nguồn nhập lại extension.", "style": "note"}] + [""] * 7},
]


mapping_headers = [
    "STT", "Mã kho", "Tên kho", "ĐVT kho", "SL kho", "Quy đổi", "Tồn bán",
    "Giá bán kho", "Mã web", "Tên web", "ĐVT web", "Giá web", "Chênh giá",
    "Trạng thái", "Tin cậy", "Kiểm tra tự động", "Quyết định kiểm soát",
    "Mã web sau duyệt", "Ghi chú kế toán", "Gợi ý hệ thống",
]
mapping_rows = [
    {"_height": 32, "cells": [{"value": "BẢNG ÁNH XẠ KHO ↔ WEB", "style": "title"}] + [""] * (len(mapping_headers) - 1)},
    {"cells": [{"value": "Các cột xanh nhạt là dữ liệu nguồn; cột Quyết định/Mã web sau duyệt/Ghi chú dành cho người kiểm soát.", "style": "subtitle"}] + [""] * (len(mapping_headers) - 1)},
    {"cells": [""] * len(mapping_headers)},
    {"_height": 30, "cells": [{"value": h, "style": "header"} for h in mapping_headers]},
]
for index, item in enumerate(inventory, start=1):
    issue = control_issue(item)
    price_diff = float(item.get("webPrice") or 0) - float(item.get("salePrice") or 0)
    decision = "GIỮ NGUYÊN" if issue == "Đủ điều kiện" else "CẦN SỬA"
    excel_row = index + 4
    mapping_rows.append({"cells": [
        {"value": index, "style": "integer"},
        {"value": item.get("stockCode", ""), "style": "text"},
        {"value": item.get("stockName", ""), "style": "text"},
        {"value": item.get("stockUnit", ""), "style": "text"},
        {"value": item.get("stockQty", 0), "style": "decimal"},
        {"value": item.get("conversion", 0), "style": "decimal"},
        {"value": item.get("availableQty", 0), "style": "integer"},
        {"value": item.get("salePrice", 0), "style": "money"},
        {"value": str(item.get("webCode", "")), "style": "text"},
        {"value": item.get("webName", ""), "style": "text"},
        {"value": item.get("webUnit", ""), "style": "text"},
        {"value": item.get("webPrice", 0), "style": "money"},
        {"value": "", "style": "money", "formula": f"L{excel_row}-H{excel_row}", "cached": price_diff},
        {"value": item.get("status", ""), "style": status_style(item.get("status"))},
        {"value": float(item.get("confidence") or 0) / 100, "style": "percent"},
        {"value": issue, "style": "ok" if issue == "Đủ điều kiện" else "warning"},
        {"value": decision, "style": "ok" if decision == "GIỮ NGUYÊN" else "warning"},
        {"value": str(item.get("webCode", "")), "style": "text"},
        {"value": item.get("reviewNote", ""), "style": "text"},
        {"value": item.get("suggestions", ""), "style": "note"},
    ]})


stock_headers = [
    "STT", "Mã kho", "Tên kho", "ĐVT", "Số lượng", "Quy đổi", "Tồn bán quy đổi",
    "Giá bán chốt", "Giá trị tồn theo giá bán", "Mã web hiện tại", "Trạng thái ánh xạ",
]
stock_rows = [
    {"_height": 32, "cells": [{"value": "KHO CHUẨN HÓA", "style": "title"}] + [""] * (len(stock_headers) - 1)},
    {"cells": [{"value": "Tồn bán quy đổi là giới hạn tối đa dùng cho bài toán không âm kho.", "style": "subtitle"}] + [""] * (len(stock_headers) - 1)},
    {"cells": [""] * len(stock_headers)},
    {"_height": 30, "cells": [{"value": h, "style": "header"} for h in stock_headers]},
]
for index, item in enumerate(inventory, start=1):
    excel_row = index + 4
    stock_rows.append({"cells": [
        {"value": index, "style": "integer"},
        {"value": item.get("stockCode", ""), "style": "text"},
        {"value": item.get("stockName", ""), "style": "text"},
        {"value": item.get("stockUnit", ""), "style": "text"},
        {"value": item.get("stockQty", 0), "style": "decimal"},
        {"value": item.get("conversion", 0), "style": "decimal"},
        {"value": item.get("availableQty", 0), "style": "integer"},
        {"value": item.get("salePrice", 0), "style": "money"},
        {"value": "", "style": "money", "formula": f"G{excel_row}*H{excel_row}", "cached": float(item.get("availableQty") or 0) * float(item.get("salePrice") or 0)},
        {"value": str(item.get("webCode", "")), "style": "text"},
        {"value": item.get("status", ""), "style": status_style(item.get("status"))},
    ]})


web_headers = ["STT", "Mã web", "Tên hàng web", "ĐVT web", "Giá web", "Loại", "Nhóm", "Số dòng kho đang ánh xạ"]
web_rows = [
    {"_height": 32, "cells": [{"value": "DANH MỤC WEB CHUẨN HÓA", "style": "title"}] + [""] * (len(web_headers) - 1)},
    {"cells": [{"value": "Danh mục web chỉ cung cấp định danh, tên, đơn vị và giá; không quyết định tồn bán.", "style": "subtitle"}] + [""] * (len(web_headers) - 1)},
    {"cells": [""] * len(web_headers)},
    {"_height": 30, "cells": [{"value": h, "style": "header"} for h in web_headers]},
]
for index, item in enumerate(catalog, start=1):
    code = str(item.get("webCode", ""))
    excel_row = index + 4
    web_rows.append({"cells": [
        {"value": index, "style": "integer"},
        {"value": code, "style": "text"},
        {"value": item.get("webName", ""), "style": "text"},
        {"value": item.get("webUnit", ""), "style": "text"},
        {"value": item.get("webPrice", 0), "style": "money"},
        {"value": item.get("webType", ""), "style": "text"},
        {"value": item.get("webGroup", ""), "style": "text"},
        {"value": "", "style": "integer", "formula": f"COUNTIF('Anh_xa_Kho_Web'!$I$5:$I$57,B{excel_row})", "cached": web_code_counts.get(code, 0)},
    ]})


issue_headers = [
    "STT", "Mức độ", "Mã kho", "Tên kho", "Tồn bán", "Giá kho", "Mã web", "Tên web",
    "Giá web", "Trạng thái", "Vấn đề", "Hành động đề xuất",
]
issue_rows = [
    {"_height": 32, "cells": [{"value": "DANH SÁCH CẦN XỬ LÝ", "style": "title"}] + [""] * (len(issue_headers) - 1)},
    {"cells": [{"value": "Ưu tiên xử lý dòng NGHIÊM TRỌNG trước; không đưa dòng chưa xác nhận vào bộ giải hóa đơn.", "style": "subtitle"}] + [""] * (len(issue_headers) - 1)},
    {"cells": [""] * len(issue_headers)},
    {"_height": 30, "cells": [{"value": h, "style": "header"} for h in issue_headers]},
]
issue_index = 0
for item in inventory:
    issue = control_issue(item)
    shared_code = web_code_counts.get(str(item.get("webCode", "")), 0) > 1
    if issue == "Đủ điều kiện" and not shared_code:
        continue
    issue_index += 1
    severity = "NGHIÊM TRỌNG" if item.get("status") == "unmatched" or not item.get("webCode") else "CẦN DUYỆT"
    if shared_code:
        issue = f"{issue}; Mã web đang được {web_code_counts[str(item.get('webCode', ''))]} dòng kho cùng sử dụng" if issue != "Đủ điều kiện" else f"Mã web đang được {web_code_counts[str(item.get('webCode', ''))]} dòng kho cùng sử dụng"
    action = "Không cho phép bán; chọn lại mã web đúng" if severity == "NGHIÊM TRỌNG" else "Đối chiếu tên/đơn vị/giá rồi xác nhận hoặc chọn lại"
    issue_rows.append({"cells": [
        {"value": issue_index, "style": "integer"},
        {"value": severity, "style": "error" if severity == "NGHIÊM TRỌNG" else "warning"},
        {"value": item.get("stockCode", ""), "style": "text"},
        {"value": item.get("stockName", ""), "style": "text"},
        {"value": item.get("availableQty", 0), "style": "integer"},
        {"value": item.get("salePrice", 0), "style": "money"},
        {"value": str(item.get("webCode", "")), "style": "text"},
        {"value": item.get("webName", ""), "style": "text"},
        {"value": item.get("webPrice", 0), "style": "money"},
        {"value": item.get("status", ""), "style": status_style(item.get("status"))},
        {"value": issue, "style": "note"},
        {"value": action, "style": "note"},
    ]})


guide_rows = [
    {"_height": 34, "cells": [{"value": "HƯỚNG DẪN KIỂM SOÁT DỮ LIỆU", "style": "title"}] + [""] * 5},
    {"cells": [{"value": "Mục tiêu: kho quyết định mặt hàng và số lượng; web chỉ cung cấp mã/tên/đơn vị/giá để lập hóa đơn.", "style": "subtitle"}] + [""] * 5},
    {"cells": [""] * 6},
    {"cells": [{"value": "Bước", "style": "header"}, {"value": "Thực hiện", "style": "header"}, {"value": "Điều kiện đạt", "style": "header"}] + [""] * 3},
    {"cells": [{"value": 1, "style": "integer"}, {"value": "Cập nhật KhoT5.xlsx và data.xlsx mới nhất.", "style": "text"}, {"value": "Không thiếu cột mã, tên, đơn vị, số lượng/quy đổi và giá.", "style": "text"}] + [""] * 3},
    {"cells": [{"value": 2, "style": "integer"}, {"value": "Mở sheet Cần_xử_lý, lọc NGHIÊM TRỌNG rồi CẦN DUYỆT.", "style": "text"}, {"value": "Không còn dòng unmatched hoặc thiếu mã web.", "style": "text"}] + [""] * 3},
    {"cells": [{"value": 3, "style": "integer"}, {"value": "Đối chiếu từng dòng tại Ánh_xạ_Kho_Web.", "style": "text"}, {"value": "Tên/ĐVT/giá hợp lý; mã web tồn tại trong Danh_mục_Web.", "style": "text"}] + [""] * 3},
    {"cells": [{"value": 4, "style": "integer"}, {"value": "Chọn Quyết định kiểm soát và ghi chú kế toán.", "style": "text"}, {"value": "Chỉ GIỮ NGUYÊN với dòng đủ điều kiện; dòng sai phải CẦN SỬA hoặc LOẠI KHỎI BÁN.", "style": "text"}] + [""] * 3},
    {"cells": [{"value": 5, "style": "integer"}, {"value": "Nhập dữ liệu đã duyệt vào extension.", "style": "text"}, {"value": "Extension chỉ dùng confirmed + tồn dương + mã/giá web hợp lệ.", "style": "text"}] + [""] * 3},
    {"cells": [""] * 6},
    {"cells": [{"value": "Quy tắc bắt buộc", "style": "header"}] + [""] * 5},
    {"cells": [{"value": "• Không dùng hàng chỉ có trên web nhưng không còn trong kho.\n• Không lấy hàng cũ trên hóa đơn làm nguồn tồn.\n• Một mã kho phải có quyết định kiểm soát rõ ràng.\n• Mặt hàng hoa quả TC/TCTO là tồn theo từng hóa đơn, mỗi hóa đơn tối đa một đĩa theo rule đã cấu hình.\n• Không dùng giảm giá để khớp tổng tiền.", "style": "note"}] + [""] * 5},
]


def styles_xml():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
    <numFmt numFmtId="166" formatCode="#,##0 [$₫-vi-VN]"/>
    <numFmt numFmtId="167" formatCode="0.0%"/>
  </numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Aptos"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
    <font><b/><sz val="10"/><color rgb="FF17365D"/><name val="Aptos"/></font>
    <font><i/><sz val="10"/><color rgb="FF526780"/><name val="Aptos"/></font>
  </fonts>
  <fills count="12">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1769E0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF153B73"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE3F6E9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE8E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDFF7E8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE4E1"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE4EF"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FFCBD8EA"/></left><right style="thin"><color rgb="FFCBD8EA"/></right><top style="thin"><color rgb="FFCBD8EA"/></top><bottom style="thin"><color rgb="FFCBD8EA"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="18">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="9" borderId="2" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>'''


sheets = [
    ("Tong_quan", sheet_xml(summary_rows, [20, 4, 20, 4, 22, 4, 20, 4], freeze_row=0, merges=["A1:H1", "A2:H2", "A15:H15", "A16:H17"])),
    ("Anh_xa_Kho_Web", sheet_xml(
        mapping_rows,
        [7, 18, 38, 12, 12, 11, 12, 16, 14, 38, 12, 16, 16, 14, 12, 30, 22, 18, 28, 55],
        freeze_row=4,
        auto_filter=f"A4:T{len(mapping_rows)}",
        merges=["A1:T1", "A2:T2"],
        validations=[(f"Q5:Q{len(mapping_rows)}", '"GIỮ NGUYÊN,CẦN SỬA,LOẠI KHỎI BÁN"')],
    )),
    ("Kho_chuan_hoa", sheet_xml(
        stock_rows,
        [7, 20, 42, 12, 14, 12, 16, 18, 24, 16, 18],
        freeze_row=4,
        auto_filter=f"A4:K{len(stock_rows)}",
        merges=["A1:K1", "A2:K2"],
    )),
    ("Danh_muc_Web", sheet_xml(
        web_rows,
        [7, 15, 48, 13, 17, 28, 24, 22],
        freeze_row=4,
        auto_filter=f"A4:H{len(web_rows)}",
        merges=["A1:H1", "A2:H2"],
    )),
    ("Can_xu_ly", sheet_xml(
        issue_rows,
        [7, 18, 20, 42, 13, 16, 15, 38, 16, 16, 55, 44],
        freeze_row=4,
        auto_filter=f"A4:L{len(issue_rows)}",
        merges=["A1:L1", "A2:L2"],
    )),
    ("Huong_dan", sheet_xml(
        guide_rows,
        [10, 55, 55, 4, 4, 4],
        freeze_row=4,
        merges=["A1:F1", "A2:F2", "A11:F11", "A12:F16"],
    )),
]


content_types = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
]
for index in range(1, len(sheets) + 1):
    content_types.append(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
content_types.append("</Types>")

workbook_sheet_entries = "".join(
    f'<sheet name="{xml_text(name)}" sheetId="{index}" r:id="rId{index}"/>'
    for index, (name, _) in enumerate(sheets, start=1)
)
workbook_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<bookViews><workbookView activeTab="0"/></bookViews>'
    f'<sheets>{workbook_sheet_entries}</sheets>'
    '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>'
    '</workbook>'
)

rels = []
for index in range(1, len(sheets) + 1):
    rels.append(
        f'<Relationship Id="rId{index}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        f'Target="worksheets/sheet{index}.xml"/>'
    )
rels.append(
    f'<Relationship Id="rId{len(sheets) + 1}" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
    'Target="styles.xml"/>'
)
workbook_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    f'{"".join(rels)}</Relationships>'
)

package_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
core_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <dc:title>Kiểm soát chuẩn hóa dữ liệu Kho - Web</dc:title>
 <dc:creator>Codex</dc:creator>
 <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
 <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
 <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>'''

app_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
 <Application>Microsoft Excel</Application>
 <DocSecurity>0</DocSecurity>
 <ScaleCrop>false</ScaleCrop>
 <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>{len(sheets)}</vt:i4></vt:variant></vt:vector></HeadingPairs>
 <TitlesOfParts><vt:vector size="{len(sheets)}" baseType="lpstr">{"".join(f"<vt:lpstr>{xml_text(name)}</vt:lpstr>" for name, _ in sheets)}</vt:vector></TitlesOfParts>
 <Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion>
</Properties>'''


with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", "".join(content_types))
    archive.writestr("_rels/.rels", package_rels)
    archive.writestr("docProps/core.xml", core_xml)
    archive.writestr("docProps/app.xml", app_xml)
    archive.writestr("xl/workbook.xml", workbook_xml)
    archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
    archive.writestr("xl/styles.xml", styles_xml())
    for index, (_, content) in enumerate(sheets, start=1):
        archive.writestr(f"xl/worksheets/sheet{index}.xml", content)

print(json.dumps({
    "output": str(OUTPUT),
    "sheets": [name for name, _ in sheets],
    "inventoryRows": len(inventory),
    "webRows": len(catalog),
    "issueRows": issue_index,
    "confirmed": confirmed_count,
    "review": review_count,
    "unmatched": unmatched_count,
    "sellable": sellable_count,
}, ensure_ascii=False))
