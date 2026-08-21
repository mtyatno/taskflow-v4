import io
import re
from datetime import datetime
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml


def _set_cell_background(cell, hex_color: str):
    """Set background color of a table cell."""
    tcPr = cell._element.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    tcPr.append(shd)


def _set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Set inner margins (padding) for a table cell."""
    tcPr = cell._element.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)


def _add_styled_runs(paragraph, text: str):
    """Parse inline markdown (bold, italic, strikethrough, code, links) and add formatted runs."""
    # Pattern for inline tokens:
    # 1. `code`
    # 2. **bold** or __bold__
    # 3. *italic* or _italic_
    # 4. ~~strike~~
    # 5. [text](url)
    token_pattern = re.compile(
        r'(`[^`]+`)'
        r'|(\*\*[^*]+\*\*|__[^_]+__)'
        r'|(\*[^*]+\*|_[^_]+_)'
        r'|(~~[^~]+~~)'
        r'|(\[[^\]]+\]\([^)]+\))'
    )

    last_idx = 0
    for m in token_pattern.finditer(text):
        start, end = m.span()
        if start > last_idx:
            # Plain text before token
            paragraph.add_run(text[last_idx:start])

        token = m.group(0)
        if token.startswith('`') and token.endswith('`'):
            # Inline code
            r = paragraph.add_run(token[1:-1])
            r.font.name = 'Consolas'
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(180, 40, 40)
        elif (token.startswith('**') and token.endswith('**')) or (token.startswith('__') and token.endswith('__')):
            # Bold
            r = paragraph.add_run(token[2:-2])
            r.bold = True
        elif (token.startswith('*') and token.endswith('*')) or (token.startswith('_') and token.endswith('_')):
            # Italic
            r = paragraph.add_run(token[1:-1])
            r.italic = True
        elif token.startswith('~~') and token.endswith('~~'):
            # Strikethrough
            r = paragraph.add_run(token[2:-2])
            r.font.strike = True
        elif token.startswith('[') and '](' in token and token.endswith(')'):
            # Link [text](url)
            link_m = re.match(r'\[([^\]]+)\]\(([^)]+)\)', token)
            if link_m:
                link_text, _ = link_m.groups()
                r = paragraph.add_run(link_text)
                r.font.color.rgb = RGBColor(37, 99, 235)  # Blue
                r.underline = True
            else:
                paragraph.add_run(token)

        last_idx = end

    if last_idx < len(text):
        paragraph.add_run(text[last_idx:])


def markdown_to_docx(title: str, content: str, meta: dict = None) -> io.BytesIO:
    """Convert Markdown content and metadata into a formatted Word (.docx) document."""
    doc = docx.Document()

    # Configure default document styles
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Segoe UI'
    normal_style.font.size = Pt(10.5)
    normal_style.font.color.rgb = RGBColor(30, 41, 59)

    # Set 1 inch page margins
    for s in doc.sections:
        s.top_margin = Inches(1.0)
        s.bottom_margin = Inches(1.0)
        s.left_margin = Inches(1.0)
        s.right_margin = Inches(1.0)

    # 1. Document Title
    doc_title = title.strip() if title else "Catatan TaskFlow"
    p_title = doc.add_paragraph()
    r_title = p_title.add_run(doc_title)
    r_title.font.name = 'Segoe UI Semibold'
    r_title.font.size = Pt(22)
    r_title.font.color.rgb = RGBColor(15, 23, 42)
    p_title.paragraph_format.space_after = Pt(4)
    p_title.paragraph_format.space_before = Pt(0)

    # 2. Metadata Subtitle (Tags, Date)
    meta = meta or {}
    meta_parts = []
    if meta.get("updated_at"):
        try:
            dt = datetime.fromisoformat(meta["updated_at"].replace("Z", "+00:00"))
            meta_parts.append("Terakhir diperbarui: " + dt.strftime("%d %b %Y, %H:%M"))
        except Exception:
            meta_parts.append("Tanggal: " + str(meta["updated_at"]))

    if meta.get("tags") and isinstance(meta["tags"], list):
        tags_str = "  ".join(f"#{t}" for t in meta["tags"] if t)
        if tags_str:
            meta_parts.append(tags_str)

    if meta_parts:
        p_meta = doc.add_paragraph()
        r_meta = p_meta.add_run(" • ".join(meta_parts))
        r_meta.font.size = Pt(9.5)
        r_meta.font.color.rgb = RGBColor(100, 116, 139)
        p_meta.paragraph_format.space_after = Pt(16)

    # Add divider line
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(14)
    p_div_border = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E2E8F0"/></w:pBdr>')
    p_div._element.get_or_add_pPr().append(p_div_border)

    # 3. Parse Content Line by Line
    lines = (content or "").split('\n')
    i = 0
    n = len(lines)

    while i < n:
        raw_line = lines[i]
        line = raw_line.strip()

        # Blank line
        if not line:
            i += 1
            continue

        # Code Block: ```
        if line.startswith('```'):
            code_lines = []
            i += 1
            while i < n and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1  # Skip closing ```

            code_text = '\n'.join(code_lines)
            p_code = doc.add_paragraph()
            p_code.paragraph_format.left_indent = Inches(0.2)
            p_code.paragraph_format.right_indent = Inches(0.2)
            p_code.paragraph_format.space_before = Pt(6)
            p_code.paragraph_format.space_after = Pt(6)

            # Code background shading
            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F1F5F9"/>')
            p_code._element.get_or_add_pPr().append(shd)

            r = p_code.add_run(code_text)
            r.font.name = 'Consolas'
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(30, 41, 59)
            continue

        # Table: starts with |
        if line.startswith('|') and '|' in line[1:]:
            tbl_lines = []
            while i < n and lines[i].strip().startswith('|'):
                tbl_lines.append(lines[i].strip())
                i += 1

            rows_data = []
            for tl in tbl_lines:
                # Skip separator lines like |---|---|
                if re.match(r'^\|(?:\s*:?-+:?\s*\|)+$', tl):
                    continue
                cells = [c.strip() for c in tl.split('|')[1:-1]]
                if cells:
                    rows_data.append(cells)

            if rows_data:
                num_cols = max(len(r) for r in rows_data)
                table = doc.add_table(rows=len(rows_data), cols=num_cols)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.autofit = True

                for r_idx, row_cells in enumerate(rows_data):
                    is_header = (r_idx == 0)
                    for c_idx in range(num_cols):
                        cell_text = row_cells[c_idx] if c_idx < len(row_cells) else ""
                        cell = table.cell(r_idx, c_idx)
                        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                        _set_cell_margins(cell, top=120, bottom=120, left=150, right=150)

                        if is_header:
                            _set_cell_background(cell, "F8FAFC")

                        p_cell = cell.paragraphs[0]
                        p_cell.paragraph_format.space_before = Pt(0)
                        p_cell.paragraph_format.space_after = Pt(0)
                        _add_styled_runs(p_cell, cell_text)
                        if is_header:
                            for r in p_cell.runs:
                                r.bold = True
                                r.font.color.rgb = RGBColor(15, 23, 42)

                # Add a space after table
                p_after_tbl = doc.add_paragraph()
                p_after_tbl.paragraph_format.space_after = Pt(8)
            continue

        # Headings: # H1, ## H2, ### H3, #### H4
        if line.startswith('#'):
            h_match = re.match(r'^(#{1,6})\s+(.*)$', line)
            if h_match:
                level = len(h_match.group(1))
                h_text = h_match.group(2).strip()

                p_h = doc.add_paragraph()
                p_h.paragraph_format.space_before = Pt(14 if level <= 2 else 10)
                p_h.paragraph_format.space_after = Pt(4)

                r_h = p_h.add_run(h_text)
                r_h.font.name = 'Segoe UI Semibold'
                r_h.bold = True
                if level == 1:
                    r_h.font.size = Pt(17)
                    r_h.font.color.rgb = RGBColor(15, 23, 42)
                elif level == 2:
                    r_h.font.size = Pt(14)
                    r_h.font.color.rgb = RGBColor(30, 41, 59)
                elif level == 3:
                    r_h.font.size = Pt(12)
                    r_h.font.color.rgb = RGBColor(51, 65, 85)
                else:
                    r_h.font.size = Pt(11)
                    r_h.font.color.rgb = RGBColor(71, 85, 105)

                i += 1
                continue

        # Checklist: - [ ] or - [x]
        check_match = re.match(r'^[-*]\s+\[([ xX])\]\s+(.*)$', line)
        if check_match:
            is_checked = check_match.group(1).lower() == 'x'
            item_text = check_match.group(2).strip()
            p_chk = doc.add_paragraph()
            p_chk.paragraph_format.left_indent = Inches(0.25)
            p_chk.paragraph_format.space_before = Pt(2)
            p_chk.paragraph_format.space_after = Pt(2)

            symbol = "☑ " if is_checked else "☐ "
            r_sym = p_chk.add_run(symbol)
            r_sym.font.name = 'Segoe UI Symbol'
            r_sym.bold = True
            r_sym.font.color.rgb = RGBColor(16, 185, 129) if is_checked else RGBColor(100, 116, 139)

            _add_styled_runs(p_chk, item_text)
            if is_checked:
                for r in p_chk.runs[1:]:
                    r.font.strike = True
                    r.font.color.rgb = RGBColor(148, 163, 184)

            i += 1
            continue

        # Blockquote: > text
        if line.startswith('>'):
            quote_text = re.sub(r'^>\s*', '', line)
            p_q = doc.add_paragraph()
            p_q.paragraph_format.left_indent = Inches(0.3)
            p_q.paragraph_format.space_before = Pt(4)
            p_q.paragraph_format.space_after = Pt(4)

            # Add left border to paragraph
            pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:left w:val="single" w:sz="18" w:space="10" w:color="94A3B8"/></w:pBdr>')
            p_q._element.get_or_add_pPr().append(pBdr)

            _add_styled_runs(p_q, quote_text)
            for r in p_q.runs:
                r.italic = True
                r.font.color.rgb = RGBColor(71, 85, 105)

            i += 1
            continue

        # Bullet List: - item or * item
        bullet_match = re.match(r'^[-*]\s+(.*)$', line)
        if bullet_match:
            item_text = bullet_match.group(1).strip()
            p_b = doc.add_paragraph()
            p_b.paragraph_format.left_indent = Inches(0.25)
            p_b.paragraph_format.space_before = Pt(2)
            p_b.paragraph_format.space_after = Pt(2)

            r_bullet = p_b.add_run("• ")
            r_bullet.bold = True
            r_bullet.font.color.rgb = RGBColor(100, 116, 139)

            _add_styled_runs(p_b, item_text)
            i += 1
            continue

        # Numbered List: 1. item
        num_match = re.match(r'^(\d+)\.\s+(.*)$', line)
        if num_match:
            num_str = num_match.group(1)
            item_text = num_match.group(2).strip()
            p_num = doc.add_paragraph()
            p_num.paragraph_format.left_indent = Inches(0.25)
            p_num.paragraph_format.space_before = Pt(2)
            p_num.paragraph_format.space_after = Pt(2)

            r_n = p_num.add_run(f"{num_str}. ")
            r_n.bold = True
            r_n.font.color.rgb = RGBColor(100, 116, 139)

            _add_styled_runs(p_num, item_text)
            i += 1
            continue

        # Inline Drawing Directive: ::draw[id]{...}
        if re.search(r'::draw\[', line):
            draw_m = re.search(r'::draw\[([^\]]+)\](?:\s*\{([^}]*)\})?', line)
            if draw_m:
                draw_id = draw_m.group(1)
                attr_raw = draw_m.group(2) or ""
                title_m = re.search(r'title="([^"]+)"', attr_raw)
                draw_title = title_m.group(1) if title_m else f"Gambar {draw_id}"

                p_draw = doc.add_paragraph()
                p_draw.paragraph_format.space_before = Pt(8)
                p_draw.paragraph_format.space_after = Pt(8)
                p_draw.paragraph_format.left_indent = Inches(0.2)
                p_draw.paragraph_format.right_indent = Inches(0.2)

                shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F8FAFC"/>')
                p_draw._element.get_or_add_pPr().append(shd)

                r_d = p_draw.add_run(f"🎨 [Gambar/Canvas: {draw_title}]")
                r_d.bold = True
                r_d.font.color.rgb = RGBColor(100, 116, 139)

            i += 1
            continue

        # Standard Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(5)
        _add_styled_runs(p, line)
        i += 1

    out_io = io.BytesIO()
    doc.save(out_io)
    out_io.seek(0)
    return out_io
