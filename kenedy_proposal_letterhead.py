#!/usr/bin/env python3
"""City of Kenedy proposals 26-228 / 26-229, set on the Triun letterhead.

Fees are the originals with $5,000 added to each line item, per Edward's
instruction:

    26-228 Convention Center HVAC Replacement    $4,900.00 -> $9,900.00
    26-229 Joe Gulley Park Remote Power Additions $13,650.00 -> $18,650.00

The letterhead ships as a .docx whose branding lives entirely in header1.xml /
footer1.xml, with a body of ten white spacer paragraphs that push text below
the logo. Rather than rebuild the page furniture, this script unpacks the
template and splices the letter into that existing body, so the logo, the
address bar, and the page-number field stay untouched.

Usage:
    unzip -q Triun_Official_Letterhead_R24_PG.docx -d unpacked/
    python3 kenedy_proposal_letterhead.py
    (cd unpacked && zip -Xrq ../Triun_Proposal_Kenedy_26-228_26-229.docx .)
"""
import re

SRC = "unpacked/word/document.xml"
FONT = "Times New Roman"
CYAN = "069BD6"
RIGHT_TAB = 8800          # text width: 12240 - 1720 - 1720
BULLET_NUMID = "5"        # -> abstractNum 0, Symbol bullet


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rpr(bold=False, color=None, sz=22, caps=False, italic=False):
    x = '<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>' % (FONT, FONT, FONT)
    if bold:
        x += "<w:b/><w:bCs/>"
    if italic:
        x += "<w:i/>"
    if caps:
        x += "<w:caps/>"
    if color:
        x += '<w:color w:val="%s"/>' % color
    x += '<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr>' % (sz, sz)
    return x


def run(text, **kw):
    return "<w:r>%s<w:t xml:space=\"preserve\">%s</w:t></w:r>" % (rpr(**kw), esc(text))


def tab(**kw):
    return "<w:r>%s<w:tab/></w:r>" % rpr(**kw)


def para(content="", before=0, after=0, left=0, hanging=0, tabs=None,
         bullet=False, border=False, keep=False, sz=22, line=None):
    """Assemble a <w:p>. pPr children are emitted in schema order."""
    p = "<w:p><w:pPr>"
    if keep:
        p += '<w:keepNext/><w:keepLines/>'
    if bullet:
        p += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="%s"/></w:numPr>' % BULLET_NUMID
    if border:
        p += ('<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" '
              'w:color="%s"/></w:pBdr>' % CYAN)
    if tabs:
        p += "<w:tabs>" + "".join(
            '<w:tab w:val="%s" w:leader="%s" w:pos="%d"/>' % (v, l, pos)
            for v, l, pos in tabs) + "</w:tabs>"
    sp = '<w:spacing w:before="%d" w:after="%d"' % (before, after)
    if line:
        sp += ' w:line="%d" w:lineRule="auto"' % line
    p += sp + "/>"
    if left or hanging:
        p += '<w:ind w:left="%d"%s/>' % (
            left, ' w:hanging="%d"' % hanging if hanging else "")
    p += '<w:contextualSpacing w:val="0"/>'
    p += rpr(sz=sz)
    p += "</w:pPr>" + content + "</w:p>"
    return p


# ---------------------------------------------------------------- content ---
ITEMS = [
    {
        "no": "26-228",
        "title": "Triun City of Kenedy - Convention Center HVAC Replacement",
        "fee": "$9,900.00",
        "scope": [
            "1 site survey by (1) engineers",
            "provide (3) stub ups fed from existing panel.",
            "provide (5) stub up fed from new meter rack. Transformer already existing",
            "each stub has 4 circuits",
            "Verification of voltage drop calculations",
            "locations of stubs to be provided by city official - Joe Hernadez",
            "Construction administration, permitting coordination, and site meeting are excluded",
        ],
    },
    {
        "no": "26-229",
        "title": "Triun City of Kenedy - Joe Gulley Park - Remote Power Additions",
        "fee": "$18,650.00",
        "scope": [
            "1 site survey by (2) engineers",
            "Replacement of (4) units adding to approximately 60 tons of cooling.",
            "Provide Mechanical, electrical, and plumbing drawings to complete HVAC replacement.",
            "each stub has 4 circuits",
            "Construction administration, permitting coordination, and site meetings are excluded",
        ],
    },
]

body = []

# Date
body.append(para(run("August 17, 2026"), after=240))

# Addressee
body.append(para(run("City of Kenedy"), after=0))
body.append(para(run("Kenedy, Texas"), after=240))

# Subject line
body.append(para(
    run("Re:", bold=True) + tab() + run("Professional Engineering Design Services", bold=True),
    tabs=[("left", "none", 720)], after=0))
body.append(para(
    tab() + run("Proposals 26-228 and 26-229"),
    tabs=[("left", "none", 720)], after=240))

# Transmittal
body.append(para(run(
    "Triun is pleased to submit the following proposals for your consideration."),
    after=280))

for item in ITEMS:
    # Item heading with cyan rule
    body.append(para(
        run(item["no"], bold=True) + tab() + run(item["title"], bold=True),
        tabs=[("left", "none", 900)], border=True, after=140, keep=True))
    # Fee line, dot leader to the right margin
    body.append(para(
        run("Design", bold=True) + tab(bold=True) + run(item["fee"], bold=True),
        tabs=[("right", "dot", RIGHT_TAB)], left=360, after=140, keep=True))
    # Scope
    body.append(para(run("Scope and Exclusions:", italic=True),
                     left=360, after=60, keep=True))
    for i, s in enumerate(item["scope"]):
        body.append(para(run(s), bullet=True, left=1080, hanging=360,
                         after=(300 if i == len(item["scope"]) - 1 else 40)))

# Closing
body.append(para(run("Thanks,"), before=120, after=360))
body.append(para(run("Edward R. De La Garza, P.E.", bold=True, caps=True,
                     color=CYAN), after=0))
body.append(para(run("President/CEO", sz=20), after=0, sz=20))
body.append(para(run("Mobile | 210.296.4822", sz=20), sz=20))

new_body = "".join(body)

# ---------------------------------------------------------------- splice ---
doc = open(SRC, encoding="utf-8").read()

# The template's white spacer paragraphs push text below the logo. Ten of them
# leaves ~1.8in of dead space; drop four so the letter balances on the page.
head, rest = doc.split("<w:body>", 1)
spacers, tail = rest.split("<w:sectPr ", 1)
paras = re.findall(r"<w:p\b.*?</w:p>", spacers, re.S)
assert len(paras) == 10, "unexpected template body: %d paragraphs" % len(paras)
spacers = "".join(paras[4:])

doc = head + "<w:body>" + spacers + new_body + "<w:sectPr " + tail

# The template ships bottom margin 0; give the text a floor that clears the
# 0.78in footer graphic.
doc = doc.replace('w:bottom="0" w:left="1720" w:header="1584" w:footer="180"',
                  'w:bottom="1440" w:left="1720" w:header="1584" w:footer="180"')

open(SRC, "w", encoding="utf-8").write(doc)
print("inserted %d paragraphs, %d bytes" % (new_body.count("<w:p>"), len(doc)))
