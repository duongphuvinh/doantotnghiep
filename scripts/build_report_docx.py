from __future__ import annotations

import html
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "BaoCao_DoAnTotNghiep.md"
OUT = ROOT / "BaoCao_DoAnTotNghiep.docx"


NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def x(text: str) -> str:
    return escape(text, {"\"": "&quot;"})


def p_pr(style: str | None = None, jc: str | None = None, page_break_before: bool = False) -> str:
    parts: list[str] = ["<w:pPr>"]
    if style:
        parts.append(f'<w:pStyle w:val="{style}"/>')
    if page_break_before:
        parts.append("<w:pageBreakBefore/>")
    if jc:
        parts.append(f'<w:jc w:val="{jc}"/>')
    parts.append("</w:pPr>")
    return "".join(parts)


def run(text: str, bold: bool = False, italic: bool = False, size: int | None = None) -> str:
    props: list[str] = []
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    if size:
        props.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    prop_xml = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    space = ' xml:space="preserve"' if text.startswith(" ") or text.endswith(" ") else ""
    return f"<w:r>{prop_xml}<w:t{space}>{x(text)}</w:t></w:r>"


def paragraph(
    text: str = "",
    style: str | None = None,
    jc: str | None = None,
    page_break_before: bool = False,
    num_id: int | None = None,
) -> str:
    pr = p_pr(style, jc, page_break_before)
    if num_id is not None:
        pr = pr.replace(
            "</w:pPr>",
            f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr></w:pPr>',
        )
    return f"<w:p>{pr}{inline_runs(text)}</w:p>"


def inline_runs(text: str) -> str:
    if not text:
        return ""
    pieces: list[str] = []
    pos = 0
    pattern = re.compile(r"(\*\*([^*]+)\*\*|`([^`]+)`)")
    for match in pattern.finditer(text):
        if match.start() > pos:
            pieces.append(run(text[pos : match.start()]))
        if match.group(2) is not None:
            pieces.append(run(match.group(2), bold=True))
        elif match.group(3) is not None:
            pieces.append(run(match.group(3), italic=True))
        pos = match.end()
    if pos < len(text):
        pieces.append(run(text[pos:]))
    return "".join(pieces)


def page_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def clean_cell(text: str) -> str:
    return text.strip().replace("<br>", "\n")


def table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    cols = max(len(row) for row in rows)
    widths = table_widths(cols)
    out = [
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
        '<w:tblW w:w="9360" w:type="dxa"/>'
        '<w:tblLook w:firstRow="1" w:noHBand="0" w:noVBand="1"/>'
        "</w:tblPr><w:tblGrid>"
    ]
    for width in widths:
        out.append(f'<w:gridCol w:w="{width}"/>')
    out.append("</w:tblGrid>")
    for r_index, row in enumerate(rows):
        out.append("<w:tr>")
        padded = row + [""] * (cols - len(row))
        for c_index, cell in enumerate(padded):
            fill = '<w:shd w:fill="E8EEF5"/>' if r_index == 0 else ""
            bold = r_index == 0
            paras = [line for line in clean_cell(cell).splitlines()] or [""]
            out.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{widths[c_index]}" w:type="dxa"/>'
                f"<w:tcMar><w:top w:w=\"100\" w:type=\"dxa\"/><w:left w:w=\"120\" w:type=\"dxa\"/>"
                f"<w:bottom w:w=\"100\" w:type=\"dxa\"/><w:right w:w=\"120\" w:type=\"dxa\"/></w:tcMar>{fill}</w:tcPr>"
            )
            for line in paras:
                out.append(f"<w:p>{p_pr('TableText')}{run(line, bold=bold)}</w:p>")
            out.append("</w:tc>")
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def table_widths(cols: int) -> list[int]:
    if cols <= 1:
        return [9360]
    if cols == 2:
        return [2800, 6560]
    if cols == 3:
        return [2300, 2500, 4560]
    if cols == 4:
        return [1800, 1800, 2500, 3260]
    base = 9360 // cols
    widths = [base] * cols
    widths[-1] += 9360 - sum(widths)
    return widths


def parse_markdown(md: str) -> list[str]:
    lines = md.splitlines()
    body: list[str] = []
    i = 0
    chapter_seen = False
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped == "---":
            body.append(paragraph(""))
            i += 1
            continue
        if stripped.startswith("|") and i + 1 < len(lines) and set(lines[i + 1].strip()) <= {"|", "-", ":", " "}:
            rows: list[list[str]] = []
            rows.append([c.strip() for c in stripped.strip("|").split("|")])
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            body.append(table(rows))
            continue
        if stripped.startswith("```"):
            code: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            for code_line in code:
                body.append(paragraph(code_line, "Code"))
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            text = heading.group(2).strip()
            style = {1: "Heading1", 2: "Heading2", 3: "Heading3"}[level]
            break_before = False
            if level == 1 and (
                text.startswith("CHƯƠNG")
                or text.startswith("TÀI LIỆU")
                or text.startswith("PHỤ LỤC")
                or text in {"LỜI CAM ĐOAN", "LỜI CẢM ƠN", "TÓM TẮT", "ABSTRACT", "MỤC LỤC"}
            ):
                break_before = chapter_seen
                chapter_seen = True
            body.append(paragraph(text, style, page_break_before=break_before))
            i += 1
            continue
        if stripped.startswith(">"):
            body.append(paragraph(stripped.lstrip("> ").strip(), "Quote"))
            i += 1
            continue
        if re.match(r"^[-*]\s+", stripped):
            body.append(paragraph(re.sub(r"^[-*]\s+", "", stripped), "ListParagraph", num_id=1))
            i += 1
            continue
        if re.match(r"^\d+\.\s+", stripped):
            body.append(paragraph(re.sub(r"^\d+\.\s+", "", stripped), "ListParagraph", num_id=2))
            i += 1
            continue
        body.append(paragraph(stripped, "Normal"))
        i += 1
    return body


def content_types() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""


def rels() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def doc_rels() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"""


def styles() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{NS_W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
{style('Normal', 'Normal', 26, '000000', spacing_after=120, line=360, justify='both')}
{style('Title', 'Title', 32, '000000', bold=True, spacing_after=240, justify='center')}
{style('Heading1', 'heading 1', 32, '000000', bold=True, spacing_before=120, spacing_after=200, outline=0)}
{style('Heading2', 'heading 2', 28, '000000', bold=True, spacing_before=180, spacing_after=120, outline=1)}
{style('Heading3', 'heading 3', 26, '333333', bold=True, italic=True, spacing_before=140, spacing_after=80, outline=2)}
{style('ListParagraph', 'List Paragraph', 26, '000000', spacing_after=80, line=360, left=720)}
{style('Quote', 'Quote', 26, '444444', italic=True, spacing_before=120, spacing_after=120, left=360)}
{style('Code', 'Code', 22, '222222', font='Consolas', spacing_after=40, line=300)}
{style('TableText', 'Table Text', 22, '000000', spacing_after=20, line=276)}
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/></w:tblBorders></w:tblPr></w:style>
</w:styles>"""


def style(
    style_id: str,
    name: str,
    size: int,
    color: str,
    bold: bool = False,
    italic: bool = False,
    font: str = "Times New Roman",
    spacing_before: int = 0,
    spacing_after: int = 120,
    line: int = 360,
    justify: str | None = None,
    left: int | None = None,
    outline: int | None = None,
) -> str:
    b = "<w:b/>" if bold else ""
    it = "<w:i/>" if italic else ""
    jc = f'<w:jc w:val="{justify}"/>' if justify else ""
    ind = f'<w:ind w:left="{left}"/>' if left is not None else ""
    ol = f'<w:outlineLvl w:val="{outline}"/>' if outline is not None else ""
    return (
        f'<w:style w:type="paragraph" w:styleId="{style_id}"><w:name w:val="{name}"/>'
        f"<w:pPr>{ol}<w:spacing w:before=\"{spacing_before}\" w:after=\"{spacing_after}\" w:line=\"{line}\" w:lineRule=\"auto\"/>{jc}{ind}</w:pPr>"
        f'<w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:cs="{font}"/>{b}{it}<w:color w:val="{color}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>'
    )


def numbering() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{NS_W}">
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>"""


def footer() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="{NS_W}" xmlns:r="{NS_R}">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Trang </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p>
</w:ftr>"""


def document_xml(body_parts: list[str]) -> str:
    sect = (
        '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>'
        '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>'
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{NS_W}" xmlns:r="{NS_R}"><w:body>{''.join(body_parts)}{sect}</w:body></w:document>"""


def core() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Báo cáo đồ án tốt nghiệp</dc:title>
<dc:subject>AI, RAG, MCP, trợ lý y khoa</dc:subject>
<dc:creator>Codex</dc:creator>
<cp:keywords>AI; RAG; MCP; y khoa; FastAPI; Next.js</cp:keywords>
</cp:coreProperties>"""


def app() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Codex OOXML Builder</Application>
</Properties>"""


def build() -> None:
    md = SOURCE.read_text(encoding="utf-8")
    body_parts = parse_markdown(md)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types())
        z.writestr("_rels/.rels", rels())
        z.writestr("word/_rels/document.xml.rels", doc_rels())
        z.writestr("word/document.xml", document_xml(body_parts))
        z.writestr("word/styles.xml", styles())
        z.writestr("word/numbering.xml", numbering())
        z.writestr("word/footer1.xml", footer())
        z.writestr("docProps/core.xml", core())
        z.writestr("docProps/app.xml", app())
    print(OUT)


if __name__ == "__main__":
    build()
