import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


path = Path(__file__).resolve().parent / "Kiem_soat_chuan_hoa_Kho_Web.xlsx"
ns = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def text_of_cell(cell):
    inline = cell.find("m:is/m:t", ns)
    if inline is not None:
        return inline.text or ""
    value = cell.find("m:v", ns)
    return value.text if value is not None else ""


with zipfile.ZipFile(path) as archive:
    bad_xml = []
    for name in archive.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            try:
                ET.fromstring(archive.read(name))
            except Exception as exc:
                bad_xml.append(f"{name}: {exc}")
    if bad_xml:
        raise SystemExit("\n".join(bad_xml))

    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_map = {item.attrib["Id"]: item.attrib["Target"] for item in rels}
    results = []
    formula_errors = []
    for sheet in workbook.find("m:sheets", ns):
        name = sheet.attrib["name"]
        rid = sheet.attrib[f"{{{ns['r']}}}id"]
        target = "xl/" + rel_map[rid]
        root = ET.fromstring(archive.read(target))
        rows = root.findall("m:sheetData/m:row", ns)
        cells = root.findall(".//m:c", ns)
        formulas = root.findall(".//m:f", ns)
        styles = [int(cell.attrib.get("s", "0")) for cell in cells]
        if styles and max(styles) > 17:
            raise SystemExit(f"{name}: style id ngoài phạm vi")
        values = [text_of_cell(cell) for cell in cells]
        for value in values:
            if re.search(r"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", value):
                formula_errors.append(f"{name}: {value}")
        results.append({
            "sheet": name,
            "rows": len(rows),
            "cells": len(cells),
            "formulas": len(formulas),
            "title": values[0] if values else "",
            "autoFilter": bool(root.find("m:autoFilter", ns) is not None),
            "freezePane": bool(root.find("m:sheetViews/m:sheetView/m:pane", ns) is not None),
        })

    required = {"Tong_quan", "Anh_xa_Kho_Web", "Kho_chuan_hoa", "Danh_muc_Web", "Can_xu_ly", "Huong_dan"}
    present = {item["sheet"] for item in results}
    if present != required:
        raise SystemExit(f"Thiếu/thừa sheet: {present ^ required}")
    if formula_errors:
        raise SystemExit("\n".join(formula_errors))

print(json.dumps({
    "file": str(path),
    "size": path.stat().st_size,
    "zipTest": "OK",
    "xmlTest": "OK",
    "formulaErrorScan": "OK",
    "sheets": results,
}, ensure_ascii=True, indent=2))
