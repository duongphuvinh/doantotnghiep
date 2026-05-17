from __future__ import annotations

import csv
from io import BytesIO, StringIO
from pathlib import Path

try:
    import fitz
except Exception:  # pragma: no cover - optional runtime dependency
    fitz = None

try:
    import openpyxl
except Exception:  # pragma: no cover - optional runtime dependency
    openpyxl = None


class UnsupportedLabFileError(ValueError):
    pass


def extract_lab_text_from_file(content: bytes, filename: str) -> str:
    suffix = Path(filename.lower()).suffix
    if suffix in {".txt", ".text"}:
        return _decode_text(content)
    if suffix == ".csv":
        return _extract_csv(content)
    if suffix == ".pdf":
        return _extract_pdf(content)
    if suffix in {".xlsx", ".xlsm"}:
        return _extract_xlsx(content)

    raise UnsupportedLabFileError("Chỉ hỗ trợ file TXT, CSV, PDF, XLSX/XLSM cho phiếu xét nghiệm")


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1258", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnsupportedLabFileError("Không đọc được encoding của file text")


def _extract_csv(content: bytes) -> str:
    text = _decode_text(content)
    reader = csv.reader(StringIO(text))
    lines: list[str] = []
    for row in reader:
        cells = [cell.strip() for cell in row if cell and cell.strip()]
        if cells:
            lines.append(" ".join(cells))
    return "\n".join(lines)


def _extract_pdf(content: bytes) -> str:
    if fitz is None:
        raise UnsupportedLabFileError("PDF support requires pymupdf")
    try:
        document = fitz.open(stream=content, filetype="pdf")
        pages = [document.load_page(i).get_text("text") for i in range(document.page_count)]
        document.close()
    except Exception as exc:
        raise UnsupportedLabFileError(f"Không đọc được PDF: {exc}") from exc

    text = "\n".join(page.strip() for page in pages if page.strip())
    if not text.strip():
        raise UnsupportedLabFileError("PDF không có text để trích xuất. Nếu là ảnh scan, cần thêm OCR.")
    return text


def _extract_xlsx(content: bytes) -> str:
    if openpyxl is None:
        raise UnsupportedLabFileError("XLSX support requires openpyxl")
    try:
        workbook = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:
        raise UnsupportedLabFileError(f"Không đọc được file Excel: {exc}") from exc

    lines: list[str] = []
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows(values_only=True):
            cells = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
            if cells:
                lines.append(" ".join(cells))
    workbook.close()
    return "\n".join(lines)

