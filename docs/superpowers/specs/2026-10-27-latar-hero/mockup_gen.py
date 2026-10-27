"""Mockup pilihan latar (Kontur/Gradasi/Lanskap/Galaksi/Objek 3D/Polos) untuk hero Dashboard + kartu Pomodoro.

python3 gen.py preview  -> preview/*.html (untuk tangkapan lokal)
python3 gen.py write     -> G-*.dc.html ke folder kanvas
"""
import math, random, os, sys, json

SCR = os.path.dirname(os.path.abspath(__file__))
TOPO_MESH = open(os.path.join(SCR, "topo_gradasi_d.txt")).read()
TOPO_KONTUR = ['M560 24 C570 10 610 6 630 18 C646 28 640 44 618 48 C594 52 552 40 560 24 Z', 'M470 0 C500 40 560 70 620 64 C690 58 720 20 730 0', 'M430 0 C460 60 540 104 620 98 C710 92 760 40 770 0', 'M390 0 C420 80 520 140 620 134 C730 128 800 60 810 0', 'M350 0 C380 100 500 176 630 170 C760 164 832 90 832 40', 'M320 40 C340 140 480 214 640 206 C780 200 832 150 832 120', 'M300 120 C330 200 460 252 620 246 C740 242 800 220 832 200', 'M290 200 C320 250 400 272 470 272', 'M730 272 C736 248 762 238 784 244 C804 250 816 262 818 272', 'M690 272 C700 230 740 212 780 218 C812 224 832 244 832 252', 'M650 272 C664 210 724 184 784 192 C812 196 832 210 832 216']

PAL = ["default", "sakura", "lavender"]
T = {
    "default": {
        "light": dict(page="#FCFCFB", card="#FFFFFF", text="#0f172a", sec="#64748b", border="#E8E8E0", accent="#A8C500", accentText="#6B8000", accentOn="#1a2a00", rgb="168,197,0", duo="rgba(168,197,0,0.22)", soft="#F4FAD6", track="rgba(15,23,42,0.08)", capBg="#FFFFFF", capBorder="#E8E8E0", danger="#B42318", dangerBg="#FEE4E2", textRgb="15,23,42", glass="rgba(255,255,255,0.85)"),
        "dark": dict(page="#171717", card="#262626", text="#e5e5e5", sec="#a3a3a3", border="#404040", accent="#A8C500", accentText="#A8C500", accentOn="#1a2a00", rgb="168,197,0", duo="rgba(168,197,0,0.22)", soft="rgba(168,197,0,0.12)", track="#3a3a3a", capBg="#1c1c1c", capBorder="#3a3a3a", danger="#FDA29B", dangerBg="rgba(240,68,56,0.16)", textRgb="229,229,229", glass="rgba(38,38,38,0.85)"),
    },
    "sakura": {
        "light": dict(page="#FDF5FA", card="#FFFFFF", text="#3A2438", sec="#694763", border="#F0D2E5", accent="#B0287E", accentText="#B0287E", accentOn="#FFFFFF", rgb="176,40,126", duo="#F2C4E1", soft="#F9E1F0", track="#F4DDEB", capBg="#FFFFFF", capBorder="#F0D2E5", danger="#B42318", dangerBg="#FEE4E2", textRgb="58,36,56", glass="rgba(255,255,255,0.85)"),
        "dark": dict(page="#1C1219", card="#291B26", text="#FBEAF5", sec="#DDBCD3", border="#3E2A3A", accent="#EE8FCB", accentText="#EE8FCB", accentOn="#2B0F24", rgb="238,143,203", duo="#573150", soft="#3A2236", track="#3E2A3A", capBg="#22161F", capBorder="#3E2A3A", danger="#FDA29B", dangerBg="rgba(240,68,56,0.16)", textRgb="251,234,245", glass="rgba(41,27,38,0.85)"),
    },
    "lavender": {
        "light": dict(page="#FAF6FD", card="#FFFFFF", text="#30243C", sec="#5B4870", border="#E2D4F0", accent="#8A3AAE", accentText="#8A3AAE", accentOn="#FFFFFF", rgb="138,58,174", duo="#DFC6F2", soft="#F1E4FA", track="#EADFF5", capBg="#FFFFFF", capBorder="#E2D4F0", danger="#B42318", dangerBg="#FEE4E2", textRgb="48,36,60", glass="rgba(255,255,255,0.85)"),
        "dark": dict(page="#18131D", card="#231C2B", text="#F3EAFB", sec="#D3C3E6", border="#382D45", accent="#CDA2F2", accentText="#CDA2F2", accentOn="#22113A", rgb="205,162,242", duo="#47375F", soft="#2F2440", track="#382D45", capBg="#1D1724", capBorder="#382D45", danger="#FDA29B", dangerBg="rgba(240,68,56,0.16)", textRgb="243,234,251", glass="rgba(35,28,43,0.85)"),
    },
}
for p in T:
    for m in T[p]:
        T[p][m]["heading"] = "'Nunito Sans', sans-serif" if p == "default" else "'Nunito', 'Nunito Sans', sans-serif"
        T[p][m]["radius"] = "18px" if p == "default" else "22px"

KINDS = [("kontur", "Kontur", "bawaan"), ("gradasi", "Gradasi", ""), ("lanskap", "Lanskap", ""),
         ("galaksi", "Galaksi", ""), ("objek", "Objek 3D", ""), ("polos", "Polos", "")]

# ---------- warna latar ----------
MESH = {
    ("default", "light"): dict(m0="#F2F8DE", m1="#D9EFA0", m2="#C8ECD6", m3="#FFEDB5", m4="#E4F2C2", line="#6B8000", op=0.20),
    ("default", "dark"): dict(m0="#1F2614", m1="#3B4C08", m2="#0E3A2C", m3="#3E3410", m4="#2B3910", line="#FFFFFF", op=0.13),
    ("sakura", "light"): dict(m0="#FCE8F1", m1="#F5C1DA", m2="#FCD5BF", m3="#E9D0F5", m4="#F8CFE0", line="#B0287E", op=0.17),
    ("sakura", "dark"): dict(m0="#3A1631", m1="#701C51", m2="#62262F", m3="#401F58", m4="#56183F", line="#FFFFFF", op=0.14),
    ("lavender", "light"): dict(m0="#F2EAFB", m1="#D8C6F6", m2="#F4CFE9", m3="#D3DBF8", m4="#E3D2F7", line="#8A3AAE", op=0.17),
    ("lavender", "dark"): dict(m0="#2A1F45", m1="#4D2786", m2="#5C1F60", m3="#212A66", m4="#3B2468", line="#FFFFFF", op=0.14),
}
LAND = {
    ("sakura", "light"): dict(sky=("#F2CFDB", "#FADFD2", "#FFD3A8"), sun="#FFF3DA", glow="rgba(255,236,200,0.85)", far1=("#E9A9B6", .75), far2=("#DCB6D6", .7), hill=("#F0936C", "#F6BB90"), ridge=("#F0A181", .92), ridgeP=("#B39AD6", "#CFBBE6"), mist=("#C9B5E3", .85), ground=("#F7C899", "#F1B07F"), tree="#94688A", trunk="#7D5672", cloud=("#FFFFFF", .45), night=False),
    ("lavender", "light"): dict(sky=("#E2D9F6", "#EEDFF4", "#F9E3E4"), sun="#FFF6EA", glow="rgba(255,240,230,0.85)", far1=("#CDB6EA", .75), far2=("#D8C8F0", .75), hill=("#A98BDA", "#C6B1EA"), ridge=("#B9A0E2", .9), ridgeP=("#8E78C8", "#B2A1DD"), mist=("#D5CBF2", .85), ground=("#E5D8F6", "#D6C5EF"), tree="#6E558F", trunk="#5A4577", cloud=("#FFFFFF", .5), night=False),
    ("default", "light"): dict(sky=("#E3F2EA", "#F0F7DE", "#FFF2C7"), sun="#FFF4C2", glow="rgba(255,236,160,0.8)", far1=("#CDE4B8", .8), far2=("#BFE0D0", .75), hill=("#A6CC63", "#C7E297"), ridge=("#B3D57B", .9), ridgeP=("#8CC7B1", "#B3DDCD"), mist=("#CBEBE2", .85), ground=("#E2EFB2", "#D1E495"), tree="#5E7F3E", trunk="#4B6531", cloud=("#FFFFFF", .55), night=False),
    ("sakura", "dark"): dict(sky=("#1D1121", "#33182F", "#552240"), sun="#FBE7F1", glow="rgba(251,231,241,0.22)", far1=("#3D1E39", .9), far2=("#45264A", .85), hill=("#4D2240", "#5C2A49"), ridge=("#542646", .95), ridgeP=("#38244F", "#47305F"), mist=("#4B3266", .55), ground=("#2B1627", "#22121E"), tree="#170B15", trunk="#120910", cloud=("#FFFFFF", .05), night=True),
    ("lavender", "dark"): dict(sky=("#13122F", "#221D48", "#3A255F"), sun="#EEE7FF", glow="rgba(238,231,255,0.2)", far1=("#2A2350", .9), far2=("#2F2858", .85), hill=("#322A5F", "#3D3271"), ridge=("#352C66", .95), ridgeP=("#2A2452", "#372E66"), mist=("#4A3F7A", .5), ground=("#1E1A3B", "#17132D"), tree="#0F0C22", trunk="#0B091A", cloud=("#FFFFFF", .05), night=True),
    ("default", "dark"): dict(sky=("#0D1816", "#132721", "#22381D"), sun="#F2F7DD", glow="rgba(242,247,221,0.18)", far1=("#1C3224", .9), far2=("#1B2F2B", .85), hill=("#223F2A", "#2B4C31"), ridge=("#264530", .95), ridgeP=("#1B3A33", "#24473F"), mist=("#2E5147", .5), ground=("#16291B", "#112016"), tree="#08140D", trunk="#060F0A", cloud=("#FFFFFF", .05), night=True),
}
GAL = {
    ("lavender", "dark"): dict(base="radial-gradient(45% 120% at 100% 100%, rgba(255,40,150,0.5) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #241860 30%, #121845 52%, #1c1650 66%, #4a1888 84%, #b0168a 100%)",
        px1=["#8a55e6", "#a465f0", "#6a3cc8", "#b77cff"], px2=["#ff3fa8", "#e0309a", "#ff6fc1", "#c22a9e"], path="#c45cf0", node="#3a2370", nodeStroke="#c45cf0", icon="#ffc94a", spark="#FFFFFF", spark2="#8fe9ff", dot="#FFFFFF", dotOp=1, tw=("#e05cf0", "#7a2fd0", "#9b5cf0", "#5a2bb8"), gem="#4a2a90", gemStroke="#b07cff", core=("#9fe8ff", "#2f8cff")),
    ("sakura", "dark"): dict(base="radial-gradient(45% 120% at 100% 100%, rgba(255,60,160,0.5) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #2a1030 30%, #1c0c22 52%, #2a0f2c 66%, #6a1258 84%, #c81f86 100%)",
        px1=["#d0438f", "#e45aa5", "#a8306f", "#f07ab8"], px2=["#ff4fa8", "#ff7cc0", "#e0309a", "#ff9ad0"], path="#ff6fc8", node="#3a1033", nodeStroke="#ff6fc8", icon="#ffc94a", spark="#FFFFFF", spark2="#ffb1e8", dot="#FFFFFF", dotOp=1, tw=("#ff9ad6", "#c02a7e", "#f070c0", "#a0205e"), gem="#5a1846", gemStroke="#ff9ad6", core=("#9fe8ff", "#2f8cff")),
    ("default", "dark"): dict(base="radial-gradient(45% 120% at 100% 100%, rgba(168,197,0,0.32) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #10201c 30%, #0b1a1e 52%, #0f2420 66%, #233c10 84%, #4f6e00 100%)",
        px1=["#5fae6a", "#7fd08a", "#3f8f5a", "#a8c500"], px2=["#a8c500", "#c9e04a", "#8fb000", "#d4ea6a"], path="#b6e03a", node="#14261c", nodeStroke="#b6e03a", icon="#ffd34a", spark="#FFFFFF", spark2="#9fffe0", dot="#FFFFFF", dotOp=1, tw=("#c9e04a", "#4f8a1a", "#7fd08a", "#2f6b3a"), gem="#1e3a22", gemStroke="#b6e03a", core=("#e8ffb0", "#a8c500")),
    ("lavender", "light"): dict(base="radial-gradient(40% 120% at 100% 100%, rgba(240,120,200,0.28) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #F3ECFC 30%, #F7F3FD 52%, #EFE6FB 70%, #E4D3F8 86%, #F1CFEA 100%)",
        px1=["#B9A0EE", "#CDB8F5", "#A98BE6", "#D9C9F7"], px2=["#F0A8D8", "#E58FCB", "#F6C2E2", "#D981C0"], path="#8A3AAE", node="#FFFFFF", nodeStroke="#8A3AAE", icon="#B07A00", spark="#8A3AAE", spark2="#C88A00", dot="#8A3AAE", dotOp=0.45, tw=("#F2C1E5", "#B78AE6", "#D9C6F7", "#9C7BE0"), gem="#F3ECFC", gemStroke="#8A3AAE", core=("#B9E6FF", "#5AA8F0")),
    ("sakura", "light"): dict(base="radial-gradient(40% 120% at 100% 100%, rgba(255,140,190,0.30) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #FCEBF3 30%, #FDF4F8 52%, #FBE8F1 70%, #F8D5E6 86%, #F6C5DC 100%)",
        px1=["#F2A8CF", "#F7C4DE", "#E98FC0", "#F9D5E8"], px2=["#EC86BC", "#F4A9CF", "#E06AA8", "#F7BCD9"], path="#B0287E", node="#FFFFFF", nodeStroke="#B0287E", icon="#B07A00", spark="#B0287E", spark2="#C88A00", dot="#B0287E", dotOp=0.4, tw=("#F9D5E8", "#E07AB4", "#F7C4DE", "#D45DA2"), gem="#FCEBF3", gemStroke="#B0287E", core=("#FFE3B0", "#F0A030")),
    ("default", "light"): dict(base="radial-gradient(40% 120% at 100% 100%, rgba(168,197,0,0.24) 0%, transparent 70%), linear-gradient(90deg, {card} 0%, #F3F9E4 30%, #F8FBEF 52%, #EEF6DA 70%, #E1EFC0 86%, #D6EAAC 100%)",
        px1=["#C9E37A", "#B9E2C6", "#D9EC9E", "#A8D8B5"], px2=["#B6D84A", "#CDE58A", "#9CC93A", "#DDEDA8"], path="#6B8000", node="#FFFFFF", nodeStroke="#6B8000", icon="#B07A00", spark="#6B8000", spark2="#C88A00", dot="#6B8000", dotOp=0.4, tw=("#D9EC9E", "#9CC93A", "#C9E37A", "#7FA61A"), gem="#F3F9E4", gemStroke="#6B8000", core=("#B9F0DA", "#2FA889")),
}
OBJ = {
    "lavender": dict(tile=("#b49bff", "#6a4ae0"), tileSide="#4b30b0", sph=("#e3d6ff", "#9d7ff2", "#5233bd"), sph2=("#ffe0d2", "#f4a08a", "#c2665c"), book=("#d6c2fb", "#9b7aea"), bookSide="#7c5bd0", ring="#efe7ff", face=("#fffdf8", "#ece0d0"), bell=("#ffd9c6", "#e8866e"), hand="#5a3dc4", tick="#7a5ad8", dot2="#f08a6e", legs="#6a4ad0", glow="rgba(157,127,242,0.28)", shadow="#6a4ac0"),
    "sakura": dict(tile=("#F79BCB", "#C2307F"), tileSide="#921F5E", sph=("#FFE0EF", "#F07BB5", "#A8246B"), sph2=("#EFE5FF", "#B39AF0", "#7A5CC8"), book=("#FBC9E2", "#E27AB0"), bookSide="#B94D86", ring="#FFE8F3", face=("#FFFDF9", "#F1E2E8"), bell=("#FFE3C6", "#F0A060"), hand="#8E1F63", tick="#C2307F", dot2="#F0A060", legs="#A8246B", glow="rgba(240,123,181,0.25)", shadow="#A8246B"),
    "default": dict(tile=("#D4EC6A", "#86A300"), tileSide="#5E7300", sph=("#F3FAD0", "#B8D640", "#6E8A00"), sph2=("#E1F7EC", "#7FD3AE", "#2F8F6B"), book=("#DDEFA0", "#A8C540"), bookSide="#7E9400", ring="#F4FADC", face=("#FFFEF8", "#EEF0DC"), bell=("#FFEAB0", "#F2B33D"), hand="#4E5C00", tick="#86A300", dot2="#F2B33D", legs="#6E8A00", glow="rgba(184,214,64,0.18)", shadow="#6E8A00"),
}
OBJBASE = {
    ("lavender", "light"): "linear-gradient(90deg, {card} 0%, #EFE7FB 28%, #F6E3F1 48%, #F7F1FA 66%, #FBEEF4 84%, #F1E0EE 100%)",
    ("sakura", "light"): "linear-gradient(90deg, {card} 0%, #FCE9F2 28%, #FDEEF1 48%, #FDF5F8 66%, #FCEFF4 84%, #F7DEEA 100%)",
    ("default", "light"): "linear-gradient(90deg, {card} 0%, #F3F9E3 28%, #F7FBEC 48%, #FAFCF4 66%, #F2F8E3 84%, #E6F2CC 100%)",
    ("lavender", "dark"): "linear-gradient(90deg, {card} 0%, #2A1F45 55%, #33235A 100%)",
    ("sakura", "dark"): "linear-gradient(90deg, {card} 0%, #3A1A35 55%, #47203F 100%)",
    ("default", "dark"): "linear-gradient(90deg, {card} 0%, #222A16 55%, #29351A 100%)",
}

UID = [0]
def uid():
    UID[0] += 1
    return f"x{UID[0]}"

def stop(o, c, a=None):
    return f'<stop offset="{o}" style="stop-color: {c};{" stop-opacity: %s;" % a if a is not None else ""}"></stop>'

def svg_abs(inner, vb, par, style_extra="", box=None):
    pos = "inset: 0; width: 100%; height: 100%;" if box is None else f"left: {box[0]}px; top: {box[1]}px; width: {box[2]}px; height: {box[3]}px;"
    return f'<svg aria-hidden="true" viewBox="{vb}" preserveAspectRatio="{par}" style="position: absolute; {pos} pointer-events: none;{style_extra}">{inner}</svg>'

FADE_LEFT = " -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 30%, #000 60%); mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 30%, #000 60%);"

# ---------- elemen gambar ----------
def flower(x, y, s, duo, acc):
    pet = "".join(f'<ellipse cx="0" cy="-7" rx="5.5" ry="7.5" transform="rotate({a})" fill="{duo}" stroke="{acc}" style="stroke-width: 1;"></ellipse>' for a in (0, 72, 144, 216, 288))
    return f'<g transform="translate({x} {y}) scale({s})">{pet}<circle cx="0" cy="0" r="2.6" fill="{acc}"></circle></g>'

def illus(p, c):
    """Ilustrasi hero Dashboard sekarang (viewBox 150x110)."""
    acc, duo, sec, at = c["accent"], c["duo"], c["sec"], c["accentText"]
    if p == "sakura":
        return (f'<path d="M150 14 C120 20 92 34 62 62" fill="none" stroke="{sec}" style="stroke-width: 2.6; stroke-linecap: round; opacity: 0.5;"></path>'
                f'<path d="M104 30 C98 50 100 70 112 86" fill="none" stroke="{sec}" style="stroke-width: 2; stroke-linecap: round; opacity: 0.5;"></path>'
                + flower(62, 62, 1, duo, acc) + flower(112, 88, 1.25, duo, acc) + flower(134, 20, 0.85, duo, acc)
                + f'<ellipse cx="0" cy="0" rx="3" ry="5" transform="translate(30 92) rotate(40)" fill="{acc}" style="opacity: 0.45;"></ellipse>'
                + f'<ellipse cx="0" cy="0" rx="2.6" ry="4.4" transform="translate(76 100) rotate(-30)" fill="{acc}" style="opacity: 0.35;"></ellipse>')
    if p == "lavender":
        out = "".join(f'<path d="{d}" fill="none" stroke="{sec}" style="stroke-width: 1.8; stroke-linecap: round; opacity: 0.5;"></path>' for d in ("M58 110 C56 84 58 60 52 34", "M82 110 C82 80 84 50 80 18", "M106 110 C108 84 110 60 114 36"))
        buds = [(52, 36, 1), (49, 48, 0), (55, 58, 1), (51, 70, 0), (80, 20, 0), (77, 32, 1), (84, 42, 0), (79, 54, 1), (85, 66, 0), (114, 38, 1), (111, 50, 0), (117, 60, 1)]
        for x, y, f in buds:
            out += (f'<ellipse cx="{x}" cy="{y}" rx="3.5" ry="5.3" fill="{acc}"></ellipse>' if f else f'<ellipse cx="{x}" cy="{y}" rx="3.6" ry="5.4" fill="{duo}" stroke="{acc}" style="stroke-width: 1;"></ellipse>')
        return out
    return (f'<path d="M70 108 C68 80 76 54 92 30" fill="none" stroke="{at}" style="stroke-width: 2; stroke-linecap: round;"></path>'
            f'<path d="M71 80 C50 76 42 60 46 48 C62 52 71 64 71 80 Z" fill="{duo}" stroke="{at}" style="stroke-width: 1.5;"></path>'
            f'<path d="M77 60 C96 54 104 38 100 26 C84 32 77 44 77 60 Z" fill="{duo}" stroke="{at}" style="stroke-width: 1.5;"></path>'
            f'<path d="M86 40 C72 32 70 18 76 8 C88 16 89 28 86 40 Z" fill="{duo}" stroke="{at}" style="stroke-width: 1.5;"></path>'
            f'<circle cx="120" cy="30" r="12" fill="{acc}" style="opacity: 0.22;"></circle>')

def sparkle(x, y, s, col, glow=True):
    k = s * 0.12
    d = (f"M{x} {y-s} C{x+k:.1f} {y-k:.1f} {x+k:.1f} {y-k:.1f} {x+s} {y} C{x+k:.1f} {y+k:.1f} {x+k:.1f} {y+k:.1f} {x} {y+s} "
         f"C{x-k:.1f} {y+k:.1f} {x-k:.1f} {y+k:.1f} {x-s} {y} C{x-k:.1f} {y-k:.1f} {x-k:.1f} {y-k:.1f} {x} {y-s} Z")
    g = f'<circle cx="{x}" cy="{y}" r="{s*0.9:.1f}" fill="{col}" style="opacity: 0.16;"></circle>' if glow else ""
    return g + f'<path d="{d}" fill="{col}"></path>'

def tree(x, y, h, w, col, trunk):
    return (f'<path d="M{x} {y-h} C{x+w*1.1:.1f} {y-h*0.55:.1f} {x+w} {y} {x} {y} C{x-w} {y} {x-w*1.1:.1f} {y-h*0.55:.1f} {x} {y-h} Z" fill="{col}"></path>'
            f'<path d="M{x} {y-h*0.15:.1f} L{x} {y+h*0.18:.1f}" stroke="{trunk}" style="stroke-width: {max(1.2, w*0.18):.1f}; stroke-linecap: round;"></path>')

def obj_defs(i, o):
    return ('<defs>'
            f'<radialGradient id="{i}sp" cx="0.35" cy="0.3" r="0.75">{stop(0, o["sph"][0])}{stop(0.38, o["sph"][1])}{stop(1, o["sph"][2])}</radialGradient>'
            f'<radialGradient id="{i}s2" cx="0.35" cy="0.3" r="0.75">{stop(0, o["sph2"][0])}{stop(0.4, o["sph2"][1])}{stop(1, o["sph2"][2])}</radialGradient>'
            f'<linearGradient id="{i}ti" x1="0" y1="0" x2="1" y2="1">{stop(0, o["tile"][0])}{stop(1, o["tile"][1])}</linearGradient>'
            f'<linearGradient id="{i}bk" x1="0" y1="0" x2="1" y2="1">{stop(0, o["book"][0])}{stop(1, o["book"][1])}</linearGradient>'
            f'<radialGradient id="{i}fc" cx="0.4" cy="0.35" r="0.7">{stop(0, o["face"][0])}{stop(1, o["face"][1])}</radialGradient>'
            f'<radialGradient id="{i}bl" cx="0.35" cy="0.3" r="0.8">{stop(0, o["bell"][0])}{stop(1, o["bell"][1])}</radialGradient>'
            f'<radialGradient id="{i}sh" cx="0.5" cy="0.5" r="0.5">{stop(0, o["shadow"], 0.26)}{stop(1, o["shadow"], 0)}</radialGradient>'
            f'<filter id="{i}b1" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4"></feGaussianBlur></filter>'
            '</defs>')

def o_tile(i, o, x, y, s, rot, blur=False):
    f = f' filter="url(#{i}b1)"' if blur else ""
    r, cs = s * 0.24, s * 0.14
    chk = f"M{-s*0.22:.1f} {s*0.02:.1f} L{-s*0.05:.1f} {s*0.18:.1f} L{s*0.25:.1f} {-s*0.16:.1f}"
    return (f'<g transform="translate({x} {y}) rotate({rot})"{f}>'
            f'<rect x="{-s/2}" y="{-s/2+s*0.09:.1f}" width="{s}" height="{s}" rx="{r:.1f}" fill="{o["tileSide"]}"></rect>'
            f'<rect x="{-s/2}" y="{-s/2}" width="{s}" height="{s}" rx="{r:.1f}" fill="url(#{i}ti)"></rect>'
            f'<rect x="{-s/2+s*0.08:.1f}" y="{-s/2+s*0.06:.1f}" width="{s*0.84:.1f}" height="{s*0.3:.1f}" rx="{r*0.8:.1f}" fill="#FFFFFF" style="opacity: 0.18;"></rect>'
            f'<path d="{chk}" transform="translate(0 {s*0.03:.1f})" fill="none" stroke="{o["tileSide"]}" style="stroke-width: {cs:.1f}; stroke-linecap: round; stroke-linejoin: round; opacity: 0.45;"></path>'
            f'<path d="{chk}" fill="none" stroke="#FFFFFF" style="stroke-width: {cs:.1f}; stroke-linecap: round; stroke-linejoin: round;"></path></g>')

def o_clock(i, o, x, y, s, rot=8):
    ticks = "".join(f'<path d="M{37*math.cos(a):.1f} {37*math.sin(a):.1f} L{32*math.cos(a):.1f} {32*math.sin(a):.1f}" stroke="{o["tick"]}" style="stroke-width: 3; stroke-linecap: round;"></path>' for a in [k * math.pi / 6 for k in range(12)])
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})">'
            f'<ellipse cx="0" cy="78" rx="56" ry="10" fill="url(#{i}sh)"></ellipse>'
            f'<path d="M-30 46 L-42 70 M30 46 L42 70" stroke="{o["legs"]}" style="stroke-width: 7; stroke-linecap: round;"></path>'
            f'<path d="M-20 -62 L20 -62 M0 -62 L0 -52" stroke="{o["legs"]}" style="stroke-width: 6; stroke-linecap: round;"></path>'
            f'<g transform="rotate(-30)"><path d="M-17 -54 A19 19 0 0 1 21 -54 Z" fill="url(#{i}bl)"></path></g>'
            f'<g transform="rotate(30)"><path d="M-21 -54 A19 19 0 0 1 17 -54 Z" fill="url(#{i}bl)"></path></g>'
            f'<circle cx="4" cy="6" r="54" fill="{o["tileSide"]}"></circle>'
            f'<circle cx="0" cy="0" r="54" fill="url(#{i}ti)"></circle>'
            f'<circle cx="0" cy="0" r="41" fill="url(#{i}fc)"></circle>' + ticks +
            f'<path d="M0 0 L0 -26 M0 0 L18 10" stroke="{o["hand"]}" style="stroke-width: 5; stroke-linecap: round;"></path>'
            f'<circle cx="0" cy="0" r="5" fill="{o["dot2"]}"></circle>'
            '<path d="M-36 -24 A44 44 0 0 1 -6 -42" fill="none" stroke="#FFFFFF" style="stroke-width: 5; stroke-linecap: round; opacity: 0.35;"></path></g>')

def o_book(i, o, x, y, s, rot=-26):
    rings = "".join(f'<path d="M-46 {yy} A7 7 0 0 1 -34 {yy}" fill="none" stroke="{o["ring"]}" style="stroke-width: 3; stroke-linecap: round;"></path>' for yy in range(-36, 46, 12))
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})">'
            f'<rect x="-40" y="-46" width="84" height="98" rx="10" fill="{o["bookSide"]}" transform="translate(5 7)"></rect>'
            f'<rect x="-40" y="-46" width="84" height="98" rx="10" fill="url(#{i}bk)"></rect>'
            '<rect x="-6" y="-34" width="40" height="22" rx="5" fill="#FFFFFF" style="opacity: 0.9;"></rect>' + rings +
            '<rect x="-34" y="-42" width="72" height="10" rx="5" fill="#FFFFFF" style="opacity: 0.18;"></rect></g>')

def o_sphere(i, x, y, r, g="sp", blur=False):
    f = f' filter="url(#{i}b1)"' if blur else ""
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#{i}{g})"{f}></circle>'

# ---------- latar ----------
def place_boxes(place, W, H):
    """Kotak fitur (ilustrasi/objek) di area kosong tiap kartu: (left, top, w, h)."""
    if place == "hero":
        return (W - 26 - 175 - 300, 4, 290, 140)
    if place == "pomo":
        return (W - 28 - 350, 68, 340, 62)
    return (W - 92, 4, 86, H - 8)  # thumb

def bg(kind, p, m, W, H, place):
    """Kembalikan (css background, html lapisan)."""
    c = T[p][m]
    dark = m == "dark"
    card = c["card"]
    i = uid()
    fx, fy, fw, fh = place_boxes(place, W, H)
    wide = place == "pomo"
    if kind == "polos":
        return (f"linear-gradient(105deg, {card} 45%, {c['soft']} 100%), {card}" if not dark else f"linear-gradient(105deg, {card} 40%, {c['page']} 100%), {card}"), ""
    if kind == "kontur":
        base = f"linear-gradient(105deg, {card} 30%, {c['soft']} 100%), {card}"
        lines = "".join(f'<path d="{d}"></path>' for d in TOPO_KONTUR)
        topo = svg_abs(f'<g fill="none" stroke="{c["accent"]}" style="stroke-width: 1.1; opacity: {0.32 if dark else 0.28};">{lines}</g>', "0 0 832 272", "xMaxYMid slice", FADE_LEFT)
        ill = svg_abs(illus(p, c), "0 0 150 110", "xMidYMid meet", box=(fx + (fw - 150) // 2 if place == "hero" else fx + fw - 120, fy if place != "pomo" else fy - 6, 150 if place == "hero" else 110, 110 if place == "hero" else 72)) if place != "thumb" else svg_abs(illus(p, c), "0 0 150 110", "xMidYMid meet", box=(fx, fy + 10, fw, fh - 20))
        return base, topo + ill
    if kind == "gradasi":
        k = MESH[(p, m)]
        base = (f"radial-gradient(55% 130% at 100% 0%, {k['m1']} 0%, transparent 70%), radial-gradient(45% 120% at 72% 100%, {k['m2']} 0%, transparent 70%), "
                f"radial-gradient(40% 110% at 45% 0%, {k['m3']} 0%, transparent 70%), linear-gradient(100deg, {card} 0%, {k['m0']} 35%, {k['m4']} 100%)")
        topo = svg_abs(f'<path d="{TOPO_MESH}" fill="none" stroke="{k["line"]}" style="stroke-width: 1.1; stroke-opacity: {k["op"]};"></path>', "0 0 1440 225", "xMaxYMid slice",
                       " -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0.25) 0%, #000 45%); mask-image: linear-gradient(to right, rgba(0,0,0,0.25) 0%, #000 45%);")
        return base, topo
    if kind == "lanskap":
        L = LAND[(p, m)]
        if place == "hero":
            sx, sy, r, top = 58, 40, 34, 0.38
        elif place == "pomo":
            sx, sy, r, top = 78, 36, 30, 0.48
        else:
            sx, sy, r, top = 56, 42, 10, 0.30
        if L["night"]:
            mx, my, mr = (66, 24, 16) if place == "hero" else ((56, 20, 18) if place == "pomo" else (70, 26, 7))
            base = (f"radial-gradient(circle {mr}px at {mx}% {my}%, {L['sun']} 0 {mr-1}px, transparent {mr}px), radial-gradient(circle {mr*4}px at {mx}% {my}%, {L['glow']} 0%, transparent 100%), "
                    f"linear-gradient(180deg, {L['sky'][0]} 0%, {L['sky'][1]} 55%, {L['sky'][2]} 100%)")
        else:
            base = (f"radial-gradient(circle {r}px at {sx}% {sy}%, {L['sun']} 0 {r-1}px, transparent {r}px), radial-gradient(circle {int(r*2.6)}px at {sx}% {sy}%, {L['glow']} 0%, transparent 100%), "
                    f"linear-gradient(180deg, {L['sky'][0]} 0%, {L['sky'][1]} 55%, {L['sky'][2]} 100%)")
        g = ('<defs>'
             f'<linearGradient id="{i}h" x1="0" y1="0" x2="0" y2="1">{stop(0, L["hill"][0])}{stop(1, L["hill"][1])}</linearGradient>'
             f'<linearGradient id="{i}p" x1="0" y1="0" x2="0" y2="1">{stop(0, L["ridgeP"][0])}{stop(1, L["ridgeP"][1])}</linearGradient>'
             f'<linearGradient id="{i}g" x1="0" y1="0" x2="0" y2="1">{stop(0, L["ground"][0])}{stop(1, L["ground"][1])}</linearGradient></defs>')
        hills = (g +
                 f'<path d="M0 28 C120 18 260 22 380 30 C300 34 120 36 0 34 Z" fill="{L["cloud"][0]}" style="opacity: {L["cloud"][1]};"></path>'
                 f'<path d="M980 26 C1100 14 1280 12 1440 20 L1440 30 C1280 26 1100 30 980 30 Z" fill="{L["cloud"][0]}" style="opacity: {L["cloud"][1]};"></path>'
                 f'<path d="M0 118 C80 88 150 62 230 70 C300 78 340 100 410 94 C480 88 530 70 610 84 C670 95 720 110 780 122 L780 225 L0 225 Z" fill="{L["far1"][0]}" style="opacity: {L["far1"][1]};"></path>'
                 f'<path d="M800 160 C870 130 960 96 1060 86 C1150 78 1230 84 1300 62 C1350 48 1410 46 1440 54 L1440 225 L800 225 Z" fill="{L["far2"][0]}" style="opacity: {L["far2"][1]};"></path>'
                 f'<path d="M0 150 C60 122 120 100 182 104 C240 108 262 126 322 128 C402 132 452 100 522 98 C602 96 682 140 762 168 C802 182 842 186 882 180 L882 225 L0 225 Z" fill="url(#{i}h)"></path>'
                 f'<path d="M760 178 C840 162 920 142 1000 132 C1060 124 1100 100 1150 104 C1200 108 1232 130 1282 120 C1340 108 1392 72 1440 64 L1440 225 L760 225 Z" fill="{L["ridge"][0]}" style="opacity: {L["ridge"][1]};"></path>'
                 f'<path d="M890 192 C970 172 1040 152 1110 152 C1180 152 1232 162 1282 142 C1340 118 1392 98 1440 94 L1440 225 L890 225 Z" fill="url(#{i}p)"></path>'
                 f'<path d="M560 202 C700 190 820 180 960 184 C1080 188 1200 178 1300 172 C1360 168 1410 170 1440 172 L1440 225 L560 225 Z" fill="{L["mist"][0]}" style="opacity: {L["mist"][1]};"></path>'
                 f'<path d="M0 192 C120 178 240 174 380 182 C520 190 620 198 760 202 C900 206 1000 204 1100 200 C1250 194 1350 190 1440 188 L1440 225 L0 225 Z" fill="url(#{i}g)"></path>')
        ht = int(round(H * top))
        layers = svg_abs(hills, "0 0 1440 225", "none", box=(0, ht, W, H - ht))
        if L["night"]:
            rnd = random.Random(5)
            st = "".join(f'<circle cx="{rnd.randint(0, 1440)}" cy="{rnd.randint(0, 120)}" r="{rnd.choice([0.8, 1, 1.3])}" fill="{L["sun"]}" style="opacity: {rnd.choice([0.4, 0.6, 0.85])};"></circle>' for _ in range(40))
            layers = svg_abs(st, "0 0 1440 300", "xMidYMin slice") + layers
        if place != "thumb":
            # pohon di area kosong
            if place == "hero":
                pts = [(fx + 232, 156, 40, 9), (fx + 250, 158, 52, 11), (fx + 292, 154, 22, 5)]
            else:
                pts = [(42, 292, 34, 8), (60, 294, 46, 10), (150, 290, 18, 4.5)]
            trees = "".join(tree(x, y, h, w, L["tree"], L["trunk"]) for x, y, h, w in pts)
            layers += svg_abs(trees, f"0 0 {W} {H}", "none")
        return base, layers
    if kind == "galaksi":
        G = GAL[(p, m)]
        base = G["base"].replace("{card}", card)
        rnd = random.Random(11)
        px1 = "".join(f'<rect x="{rnd.randrange(0, 80, 8)}" y="{rnd.randrange(0, 80, 8)}" width="7" height="7" fill="{rnd.choice(G["px1"])}" style="opacity: {rnd.choice([0.35, 0.5, 0.7, 0.9])};"></rect>' for _ in range(22))
        px2 = "".join(f'<rect x="{rnd.randrange(0, 80, 8)}" y="{rnd.randrange(0, 80, 8)}" width="7" height="7" fill="{rnd.choice(G["px2"])}" style="opacity: {rnd.choice([0.35, 0.5, 0.7, 0.9])};"></rect>' for _ in range(22))
        dots = "".join(f'<circle cx="{rnd.randint(300, 1440)}" cy="{rnd.randint(0, 300)}" r="{rnd.choice([0.8, 1, 1.3, 1.6])}" fill="{G["dot"]}" style="opacity: {rnd.choice([0.35, 0.55, 0.8]) * G["dotOp"]:.2f};"></circle>' for _ in range(45))
        defs = ('<defs>'
                f'<pattern id="{i}p1" width="80" height="80" patternUnits="userSpaceOnUse">{px1}</pattern>'
                f'<pattern id="{i}p2" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="translate(37 21)">{px2}</pattern>'
                f'<linearGradient id="{i}ml" x1="0" y1="0" x2="1" y2="0">{stop(0, "#FFFFFF", 0.55)}{stop(0.07, "#FFFFFF", 0)}{stop(1, "#FFFFFF", 0)}</linearGradient>'
                f'<linearGradient id="{i}mr" x1="0" y1="0" x2="1" y2="0">{stop(0, "#FFFFFF", 0)}{stop(0.7, "#FFFFFF", 0)}{stop(0.86, "#FFFFFF", 0.8)}{stop(1, "#FFFFFF", 1)}</linearGradient>'
                f'<mask id="{i}kl"><rect width="1440" height="300" fill="url(#{i}ml)"></rect></mask>'
                f'<mask id="{i}kr"><rect width="1440" height="300" fill="url(#{i}mr)"></rect></mask></defs>')
        def neon(d):
            return (f'<path d="{d}" fill="none" stroke="{G["path"]}" style="stroke-width: 7; stroke-opacity: 0.16; stroke-linejoin: round;"></path>'
                    f'<path d="{d}" fill="none" stroke="{G["path"]}" style="stroke-width: 2.2; stroke-linejoin: round;"></path>')
        def diamond(x, y, s=16):
            return (f'<rect x="{x-s}" y="{y-s}" width="{2*s}" height="{2*s}" rx="5" transform="rotate(45 {x} {y})" fill="{G["node"]}" stroke="{G["nodeStroke"]}" style="stroke-width: 2;"></rect>'
                    + sparkle(x, y, s * 0.62, G["icon"], False))
        if place == "pomo":
            rp = random.Random(3)
            pdots = "".join(f'<circle cx="{rp.randint(0, W)}" cy="{rp.randint(0, H)}" r="{rp.choice([0.8, 1, 1.3])}" fill="{G["dot"]}" style="opacity: {rp.choice([0.3, 0.45, 0.6]) * G["dotOp"]:.2f};"></circle>' for _ in range(40))
            pdefs = ('<defs>'
                     f'<pattern id="{i}p2" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="translate(37 21)">{px2}</pattern>'
                     f'<linearGradient id="{i}mr" x1="0" y1="0" x2="1" y2="0">{stop(0, "#FFFFFF", 0)}{stop(0.9, "#FFFFFF", 0)}{stop(1, "#FFFFFF", 0.85)}</linearGradient>'
                     f'<mask id="{i}kr"><rect width="{W}" height="{H}" fill="url(#{i}mr)"></rect></mask></defs>')
            amb = pdefs + f'<rect width="{W}" height="{H}" fill="url(#{i}p2)" mask="url(#{i}kr)"></rect>' + pdots + sparkle(int(W * 0.47), 34, 8, G["spark"]) + sparkle(W - 70, H - 26, 6, G["spark2"])
            layers = svg_abs(amb, f"0 0 {W} {H}", "none")
        else:
            amb = (defs + f'<rect width="1440" height="300" fill="url(#{i}p1)" mask="url(#{i}kl)"></rect>'
                   f'<rect width="1440" height="300" fill="url(#{i}p2)" mask="url(#{i}kr)"></rect>' + dots
                   + neon("M780 300 L840 250 L1010 250 L1060 200 L1060 160 L1110 120 L1200 120 L1240 80 L1440 80")
                   + f'<circle cx="1010" cy="250" r="11" fill="{G["node"]}" stroke="{G["nodeStroke"]}" style="stroke-width: 2;"></circle>' + sparkle(1010, 250, 7, G["spark2"], False)
                   + diamond(1110, 120) + diamond(1240, 80)
                   + sparkle(905, 40, 9, G["spark"]) + sparkle(1150, 205, 7, G["spark"]) + sparkle(1330, 170, 9, G["spark2"]) + sparkle(1390, 40, 6, G["spark"]))
            layers = svg_abs(amb, "0 0 1440 300", "xMaxYMid slice")
        if place != "thumb":
            tw = G["tw"]
            tg = (f'<defs><linearGradient id="{i}t1" x1="0" y1="0" x2="1" y2="1">{stop(0, tw[0])}{stop(1, tw[1])}</linearGradient>'
                  f'<linearGradient id="{i}t2" x1="0" y1="0" x2="0" y2="1">{stop(0, tw[2])}{stop(1, tw[3])}</linearGradient>'
                  f'<linearGradient id="{i}co" x1="0" y1="0" x2="0" y2="1">{stop(0, G["core"][0])}{stop(1, G["core"][1])}</linearGradient></defs>')
            tower = (tg + f'<path d="M22 225 L10 120 L40 150 L50 225 Z" fill="url(#{i}t1)"></path>'
                     f'<path d="M52 225 L40 112 L80 140 L90 225 Z" fill="url(#{i}t2)"></path>'
                     f'<path d="M128 225 L140 112 L100 140 L92 225 Z" fill="url(#{i}t2)"></path>'
                     f'<path d="M158 225 L170 120 L140 150 L130 225 Z" fill="url(#{i}t1)"></path>'
                     f'<path d="M40 112 L56 84 L80 140 Z M140 112 L124 84 L100 140 Z" fill="{tw[0]}" style="opacity: 0.9;"></path>'
                     f'<path d="M52 70 L68 56 L112 56 L128 70 L112 84 L68 84 Z" fill="{G["gem"]}" stroke="{G["gemStroke"]}" style="stroke-width: 2;"></path>'
                     f'<rect x="85" y="92" width="10" height="133" rx="5" fill="{G["core"][1]}" style="opacity: 0.35;"></rect>'
                     f'<rect x="87" y="92" width="6" height="133" rx="3" fill="url(#{i}co)"></rect>'
                     + sparkle(20, 60, 7, G["spark"]) + sparkle(160, 40, 5, G["spark2"]))
            if place == "hero":
                layers += svg_abs(tower, "0 0 180 225", "xMidYMax meet", box=(fx + 60, fy, 180, fh))
            else:
                # kartu Pomodoro: jalur misi mendatar + permata kecil
                row = (tg + neon("M0 40 L60 40 L80 22 L190 22 L210 40 L320 40")
                       + diamond(80, 22, 12) + diamond(210, 40, 12)
                       + f'<path d="M262 40 L270 18 L282 30 L294 18 L302 40 Z" fill="url(#{i}t1)"></path>'
                       + sparkle(140, 50, 6, G["spark"]) + sparkle(320, 12, 6, G["spark2"]))
                layers += svg_abs(row, "0 0 330 60", "xMidYMid meet", box=(fx, fy, fw, fh))
        return base, layers
    if kind == "objek":
        o = OBJ[p]
        base = OBJBASE[(p, m)].replace("{card}", card)
        if dark:
            base = f"radial-gradient(40% 130% at 72% 40%, {o['glow']} 0%, transparent 70%), " + base
        d = obj_defs(i, o)
        amb = svg_abs(obj_defs(i + "a", o) + o_sphere(i + "a", 1300, 250, 26, "sp", True) + o_sphere(i + "a", 1420, 40, 30, "s2", True), "0 0 1440 300", "xMaxYMid slice")
        if place == "thumb":
            cl = d + o_book(i, o, 50, 70, 0.55) + o_clock(i, o, 112, 70, 0.55) + o_tile(i, o, 160, 120, 52, -12) + o_sphere(i, 80, 138, 18)
            return base, svg_abs(cl, "0 0 200 160", "xMidYMid meet", box=(fx - 20, fy, fw + 20, fh))
        if place == "hero":
            cl = (d + o_sphere(i, 18, 150, 11, "sp", True) + o_book(i, o, 62, 70, 0.68) + o_sphere(i, 118, 160, 22)
                  + o_clock(i, o, 196, 96, 0.82) + o_tile(i, o, 312, 120, 78, -12) + o_sphere(i, 380, 36, 18, "s2", True))
            return base, amb + svg_abs(cl, "0 0 400 190", "xMidYMid meet", box=(fx, fy, fw, fh))
        cl = (d + o_sphere(i, 30, 60, 16, "sp", True) + o_book(i, o, 90, 62, 0.55, -18) + o_clock(i, o, 190, 64, 0.62, 6)
              + o_tile(i, o, 290, 70, 60, -10) + o_sphere(i, 360, 76, 22) + o_sphere(i, 400, 30, 14, "s2", True))
        return base, svg_abs(cl, "0 0 420 125", "xMidYMid meet", box=(fx, fy - 4, fw, fh + 8))
    raise ValueError(kind)

# ---------- kartu ----------
HERO_H = 246
POMO_H = 304

def ico_cal():
    return '<svg aria-hidden="true" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" style="stroke-width: 2;"></rect><path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" style="stroke-width: 2; stroke-linecap: round;"></path></svg>'

def hero(kind, p, m, W):
    c = T[p][m]
    dark = m == "dark"
    base, layers = bg(kind, p, m, W, HERO_H, "hero")
    tag = f"rgba({c['rgb']},{'0.18' if dark else '0.12'})"
    circ = 2 * math.pi * 25
    ring = f"{circ*12/18:.1f} {circ:.1f}"
    chip = f"display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px 6px 7px; border-radius: 999px; background: {c['card']}; border: 1px solid {c['border']}; font-family: inherit; font-size: 13px; color: {c['text']};"
    circle = f'<span style="width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid {c["accent"]}; box-sizing: border-box;"></span>'
    return f'''<section style="position: relative; overflow: hidden; box-sizing: border-box; width: {W}px; height: {HERO_H}px; border-radius: {c['radius']}; padding: 22px 26px 20px; background: {base}; border: 1px solid rgba({c['rgb']},{'0.22' if dark else '0.25'}); box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.05);">{layers}
<div style="position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;">
<div style="min-width: 0; max-width: 420px;">
<div style="display: flex; align-items: center; gap: 10px;">
<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: {c['sec']};">{ico_cal()} Selasa, 27 Oktober 2026</span>
<span style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 6px; border-radius: 999px; background: {tag}; color: {c['accentText']}; font-size: 12px; font-weight: 700;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7z" fill="{c['duo']}" stroke="currentColor" style="stroke-width: 1.8; stroke-linejoin: round;"></path></svg>5 hari beruntun</span>
</div>
<h1 style="margin: 8px 0 6px; font-family: {c['heading']}; font-size: 26px; font-weight: 800; letter-spacing: -0.4px; line-height: 1.2; color: {c['text']};">Selamat pagi, <span style="color: {c['accentText']};">Yatno</span></h1>
<div style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: {c['sec']};"><span>Ada 18 prioritas hari ini.</span><span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: {c['dangerBg']}; color: {c['danger']}; font-size: 12.5px; font-weight: 700;">3 terlambat</span></div>
</div>
<button type="button" aria-label="Buka Fokus Hari Ini" style="display: flex; align-items: center; gap: 12px; flex-shrink: 0; padding: 10px 16px 10px 10px; border-radius: 16px; background: {c['glass']}; border: 1px solid {c['border']}; font-family: inherit;">
<span style="position: relative; width: 60px; height: 60px; display: block;"><svg aria-hidden="true" viewBox="0 0 60 60" style="width: 60px; height: 60px; display: block; transform: rotate(-90deg);"><circle cx="30" cy="30" r="25" fill="none" stroke="{c['track']}" style="stroke-width: 6;"></circle><circle cx="30" cy="30" r="25" fill="none" stroke="{c['accent']}" style="stroke-width: 6; stroke-linecap: round; stroke-dasharray: {ring};"></circle></svg>
<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; color: {c['text']};">67%</span></span>
<span style="display: flex; flex-direction: column; line-height: 1.25; text-align: left;"><b style="font-size: 19px; font-weight: 800; color: {c['text']};">12/18</b><span style="font-size: 12px; color: {c['sec']};">selesai hari ini</span></span>
</button>
</div>
<div style="position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; margin-top: 14px;">
<div style="display: inline-flex; align-items: center; gap: 8px; padding: 4px 4px 4px 12px; border-radius: 999px; background: {c['card']}; border: 1px solid {c['border']}; font-size: 13px; max-width: 330px;">
<svg aria-hidden="true" viewBox="0 0 24 24" style="width: 15px; height: 15px; flex-shrink: 0;"><circle cx="12" cy="12" r="9" fill="{c['duo']}" stroke="{c['accent']}" style="stroke-width: 2;"></circle><circle cx="12" cy="12" r="4" fill="none" stroke="{c['accent']}" style="stroke-width: 2;"></circle></svg>
<span style="font-weight: 800; color: {c['accentText']};">Fokus</span>
<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: {c['text']};">Review data dossier minggu ini</span>
<button type="button" style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 5px 11px 5px 9px; border-radius: 999px; border: none; background: {c['accent']}; color: {c['accentOn']}; font-family: inherit; font-size: 12.5px; font-weight: 800;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><path d="M7 4 L19 12 L7 20 Z" fill="currentColor"></path></svg>Mulai</button>
</div>
<button type="button" style="{chip}">{circle}Minum air</button>
<button type="button" style="{chip}">{circle}Baca buku</button>
<button type="button" style="padding: 6px 10px; border-radius: 999px; background: {c['card']}; border: 1px dashed {c['border']}; font-family: inherit; font-size: 12.5px; font-weight: 700; color: {c['sec']};">+2</button>
</div>
<label style="position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; margin-top: 16px; border-radius: 12px; padding: 10px 12px 10px 14px; background: {c['capBg']}; border: 1.5px solid {c['capBorder']}; min-height: 44px; box-sizing: border-box;">
<svg aria-hidden="true" viewBox="0 0 24 24" style="width: 17px; height: 17px; flex-shrink: 0;"><path d="M13 2 L4 14 h7 l-1 8 l9 -12 h-7 z" fill="none" stroke="{c['accent']}" style="stroke-width: 2; stroke-linejoin: round;"></path></svg>
<input type="text" aria-label="Tangkap cepat" placeholder="Tulis apa saja... (tekan Enter untuk simpan)" style="flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-family: inherit; font-size: 14px; color: {c['text']};">
<kbd style="font-family: inherit; font-size: 11px; font-weight: 700; color: {c['sec']}; border: 1px solid {c['capBorder']}; border-bottom-width: 2px; border-radius: 6px; padding: 1px 7px;">Enter</kbd>
</label>
</section>'''

def hex_rgb(h):
    h = h.lstrip("#")
    return ",".join(str(int(h[k:k + 2], 16)) for k in (0, 2, 4))

def pomo(kind, p, m, W):
    c = T[p][m]
    dark = m == "dark"
    base, layers = bg(kind, p, m, W, POMO_H, "pomo")
    inkRgb = "239,68,68"
    ink = "#ef4444"
    inkText = "#f87171" if dark else "#dc2626"
    inkSoft = f"rgba({inkRgb},{'0.18' if dark else '0.12'})"
    chipBg = f"rgba({c['textRgb']},{'0.07' if dark else '0.05'})"
    chipBorder = f"rgba({c['textRgb']},{'0.16' if dark else '0.12'})"
    btnBg = "rgba(255,255,255,0.08)" if dark else c["card"]
    taskBg = "rgba(0,0,0,0.18)" if dark else "rgba(255,255,255,0.78)"
    red = "#f87171" if dark else "#dc2626"
    green = "#4ade80" if dark else "#15803d"
    circ = 2 * math.pi * 76
    ring = f"{circ*0.26:.1f} {circ:.1f}"
    glow = f"radial-gradient(circle at 30% 50%, rgba({inkRgb},{'0.20' if dark else '0.10'}) 0%, transparent 60%)"
    btn2 = f"display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 700; background: {btnBg}; color: {c['text']}; border: 1px solid {chipBorder};"
    stat = f"font-size: 11px; font-weight: 700; color: {c['sec']}; text-transform: uppercase; letter-spacing: .5px;"
    return f'''<section style="position: relative; overflow: hidden; box-sizing: border-box; width: {W}px; height: {POMO_H}px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 28px; align-items: center; border-radius: 20px; padding: 24px 28px; background: {base}; border: 1px solid {c['border'] if dark else 'rgba(%s,0.22)' % c['rgb']}; box-shadow: {'none' if dark else '0 1px 2px rgba(15,23,42,0.04), 0 6px 20px rgba(15,23,42,0.05)'};">{layers}
<div aria-hidden="true" style="position: absolute; top: -60%; left: -10%; width: 60%; height: 200%; background: {glow}; pointer-events: none;"></div>
<div style="position: relative; width: 168px; height: 168px; border-radius: 50%; background: radial-gradient(circle closest-side, rgba({hex_rgb(c['card'])},{'0.62' if dark else '0.8'}) 0%, rgba({hex_rgb(c['card'])},{'0.45' if dark else '0.6'}) 86%, transparent 100%);">
<svg aria-hidden="true" viewBox="0 0 168 168" style="width: 168px; height: 168px; display: block; transform: rotate(-90deg);"><circle cx="84" cy="84" r="76" fill="none" stroke="{'rgba(%s,0.14)' % c['textRgb'] if dark else 'rgba(%s,0.09)' % c['textRgb']}" style="stroke-width: 9;"></circle><circle cx="84" cy="84" r="76" fill="none" stroke="{ink}" style="stroke-width: 9; stroke-linecap: round; stroke-dasharray: {ring};"></circle></svg>
<div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;"><span style="font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 42px; font-weight: 700; letter-spacing: -1.5px; color: {inkText}; line-height: 1;">18:42</span><span style="font-size: 11px; color: {c['sec']}; margin-top: 6px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Fokus</span></div>
</div>
<div style="position: relative; display: flex; flex-direction: column; gap: 14px; min-width: 0;">
<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
<div><h2 style="margin: 0; display: flex; align-items: center; gap: 8px; font-family: {c['heading']}; font-size: 19px; font-weight: 800; color: {c['text']};"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 18px; height: 18px;"><circle cx="12" cy="13" r="8" fill="{inkSoft}" stroke="{inkText}" style="stroke-width: 2;"></circle><path d="M12 9v4l2.5 2" fill="none" stroke="{inkText}" style="stroke-width: 2; stroke-linecap: round;"></path></svg>Pomodoro</h2>
<p style="margin: 2px 0 0; font-size: 13px; color: {c['sec']};">Fokus pada satu task</p></div>
<div style="display: flex; align-items: center; gap: 8px;">
<button type="button" aria-label="Zen Mode" style="width: 38px; height: 34px; border-radius: 10px; border: 1px solid {chipBorder}; background: {btnBg}; color: {c['sec']}; display: inline-flex; align-items: center; justify-content: center;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 17px; height: 17px;"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" style="stroke-width: 2;"></path><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" style="stroke-width: 2;"></circle></svg></button>
<div role="radiogroup" aria-label="Mode Pomodoro" style="display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: {btnBg}; border: 1px solid {chipBorder};">
<button type="button" style="border: none; font: inherit; font-size: 13px; font-weight: 700; padding: 5px 13px; border-radius: 999px; background: {inkSoft}; color: {inkText};">Work</button>
<button type="button" style="border: none; background: transparent; font: inherit; font-size: 13px; font-weight: 700; padding: 5px 13px; border-radius: 999px; color: {c['sec']};">Short</button>
<button type="button" style="border: none; background: transparent; font: inherit; font-size: 13px; font-weight: 700; padding: 5px 13px; border-radius: 999px; color: {c['sec']};">Long</button>
</div></div></div>
<div style="display: flex; gap: 8px;">
<button type="button" style="display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 20px; border-radius: 999px; border: none; font: inherit; font-size: 14px; font-weight: 700; background: #f59e0b; color: #1f1300;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"></rect><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"></rect></svg>Jeda</button>
<button type="button" style="{btn2}"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path d="M5 5 L14 12 L5 19 Z M15 5 h3 v14 h-3 Z" fill="currentColor"></path></svg>Lewati</button>
<button type="button" style="{btn2}"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"></rect></svg>Stop</button>
</div>
<label style="display: block; border-bottom: 1px solid {chipBorder};"><input type="text" aria-label="Parkir distraksi" placeholder="Ada pikiran lewat? Ketik &amp; tekan Enter untuk simpan ke Inbox..." style="width: 100%; box-sizing: border-box; border: 0; outline: none; background: transparent; font: inherit; font-size: 13.5px; padding: 8px 2px; color: {c['text']};"></label>
<div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: {taskBg}; border: 1px solid {chipBorder};">
<span style="width: 30px; height: 30px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: {inkSoft}; color: {inkText}; flex-shrink: 0;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 16px; height: 16px;"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" style="stroke-width: 2;"></circle><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" style="stroke-width: 2;"></circle></svg></span>
<span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 10px; font-weight: 800; color: {c['sec']}; text-transform: uppercase; letter-spacing: .06em;">Task aktif</span><span style="display: block; font-size: 14.5px; font-weight: 700; color: {c['text']}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">followup data dossier msbt besok</span></span>
<span style="font-size: 13px; font-weight: 700; color: {c['sec']};"><span style="color: {red};">3</span> / 1</span>
</div>
<div style="display: flex; align-items: center; gap: 24px;">
<span style="display: flex; align-items: baseline; gap: 7px;"><b style="font-size: 18px; font-weight: 800; color: {red};">1</b><span style="{stat}">Pomodoro</span></span>
<span style="display: flex; align-items: baseline; gap: 7px;"><b style="font-size: 18px; font-weight: 800; color: {green};">23m</b><span style="{stat}">Waktu fokus</span></span>
<span style="display: flex; align-items: baseline; gap: 7px;"><b style="font-size: 18px; font-weight: 800; color: {c['accentText']};">0</b><span style="{stat}">Set lengkap</span></span>
<span style="margin-left: auto; display: flex; align-items: center; gap: 8px; color: {c['sec']};"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 16px; height: 16px;"><path d="M4 14v-2a8 8 0 0 1 16 0v2 M4 14h3v5H5a1 1 0 0 1-1-1z M20 14h-3v5h2a1 1 0 0 0 1-1z" fill="none" stroke="currentColor" style="stroke-width: 2; stroke-linejoin: round;"></path></svg>
<select aria-label="Suara latar" style="font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 8px; background: {btnBg}; color: {c['text']}; border: 1px solid {chipBorder};"><option>Hujan</option></select></span>
</div></div></section>'''

# ---------- artboard ----------
CW = 960
GAP = 32

def grid_board(kind, m):
    cols = []
    for p in PAL:
        cols.append(f'<div style="display: flex; flex-direction: column; gap: 24px;">{hero(kind, p, m, CW)}{pomo(kind, p, m, CW)}</div>')
    W = GAP + 3 * (CW + GAP)
    H = GAP + HERO_H + 24 + POMO_H + GAP
    bgpage = "#F4F2F6" if m == "light" else "#141216"
    body = f'<div style="width: {W}px; height: {H}px; box-sizing: border-box; padding: {GAP}px; display: flex; gap: {GAP}px; background: {bgpage}; font-family: \'Nunito Sans\', -apple-system, \'Segoe UI\', sans-serif;">{"".join(cols)}</div>'
    return body, W, H

def settings_board(p="sakura", m="light", sel="lanskap"):
    c = T[p][m]
    tiles = []
    for k, name, badge in KINDS:
        base, layers = bg(k, p, m, 196, 78, "thumb")
        on = k == sel
        border = f"2px solid {c['accent']}" if on else f"1px solid {c['border']}"
        ring_ = f"box-shadow: 0 0 0 3px rgba({c['rgb']},0.18);" if on else ""
        badge_html = f'<span style="font-size: 11px; font-weight: 700; color: {c["sec"]};">{badge.capitalize()}</span>' if badge else ""
        check = (f'<span style="position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border-radius: 50%; background: {c["accent"]}; display: inline-flex; align-items: center; justify-content: center; z-index: 2;"><svg aria-hidden="true" viewBox="0 0 24 24" style="width: 12px; height: 12px;"><path d="M5 12 L10 17 L19 7" fill="none" stroke="{c["accentOn"]}" style="stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;"></path></svg></span>' if on else "")
        tiles.append(f'''<button type="button" role="radio" aria-checked="{'true' if on else 'false'}" style="position: relative; display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 14px; border: {border}; {ring_} background: {c['card']}; font-family: inherit; text-align: left; cursor: pointer;">{check}
<span style="position: relative; display: block; width: 196px; height: 78px; border-radius: 9px; overflow: hidden; background: {base}; border: 1px solid rgba({c['textRgb']},0.08); box-sizing: border-box;">{layers}</span>
<span style="display: flex; align-items: baseline; gap: 6px; padding: 0 2px 2px;"><b style="font-size: 13.5px; font-weight: 800; color: {c['text']};">{name}</b>{badge_html}</span></button>''')
    pill = lambda t, on: f'<button type="button" role="radio" aria-checked="{"true" if on else "false"}" style="border: 1px solid {c["accent"] if on else c["border"]}; background: {c["accent"] if on else c["card"]}; color: {c["accentOn"] if on else c["text"]}; font: inherit; font-size: 13px; font-weight: 700; padding: 7px 14px; border-radius: 999px;">{t}</button>'
    def palcard(name, cols, on):
        dots = "".join(f'<span style="width: 18px; height: 18px; border-radius: 50%; background: {x}; border: 1px solid rgba(0,0,0,0.08);"></span>' for x in cols)
        return f'<button type="button" aria-pressed="{"true" if on else "false"}" style="display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; border: {"2px solid " + c["accent"] if on else "1px solid " + c["border"]}; {"box-shadow: 0 0 0 3px rgba(%s,0.18);" % c["rgb"] if on else ""} background: {c["card"]}; font: inherit; text-align: left;"><span style="display: flex; gap: 6px;">{dots}</span><b style="font-size: 13.5px; color: {c["text"]};">{name}</b></button>'
    lab = f"display: block; font-size: 12px; font-weight: 800; color: {c['sec']}; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 10px;"
    scale = 0.68
    prev_h = hero(sel, p, m, CW)
    prev_p = pomo(sel, p, m, CW)
    ph, pp = HERO_H * scale, POMO_H * scale
    body = f'''<div style="width: 820px; box-sizing: border-box; padding: 32px 50px; background: {c['page']}; font-family: 'Nunito Sans', -apple-system, 'Segoe UI', sans-serif; color: {c['text']};">
<section style="box-sizing: border-box; width: 720px; padding: 24px; border-radius: 18px; background: {c['card']}; border: 1px solid {c['border']};">
<h2 style="margin: 0 0 20px; font-family: {c['heading']}; font-size: 19px; font-weight: 800;">Tampilan</h2>
<span style="{lab}">Mode</span>
<div role="radiogroup" aria-label="Mode" style="display: flex; gap: 8px; margin-bottom: 22px;">{pill("Terang", True)}{pill("Gelap", False)}{pill("Ikuti sistem", False)}</div>
<span style="{lab}">Palet</span>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 22px;">{palcard("Default", ["#A8C500", "#F4FAD6", "#FCFCFB"], p == "default")}{palcard("Sakura", ["#B0287E", "#F9E1F0", "#FDF5FA"], p == "sakura")}{palcard("Lavender", ["#8A3AAE", "#F1E4FA", "#FAF6FD"], p == "lavender")}</div>
<span style="{lab}">Latar</span>
<p style="margin: -4px 0 12px; font-size: 13px; color: {c['sec']};">Untuk bagian atas Dashboard dan kartu Pomodoro di Fokus Hari Ini.</p>
<div role="radiogroup" aria-label="Latar" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 22px;">{"".join(tiles)}</div>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid {c['border']}; border-bottom: 1px solid {c['border']}; margin-bottom: 22px;">
<span><b style="display: block; font-size: 14px;">Dekorasi tema</b><span style="font-size: 13px; color: {c['sec']};">Kelopak dan maskot di layar kosong</span></span>
<button type="button" role="switch" aria-checked="true" aria-label="Dekorasi tema" style="width: 44px; height: 26px; border-radius: 999px; border: none; background: {c['accent']}; position: relative; padding: 0;"><span style="position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%; background: #FFFFFF;"></span></button>
</div>
<span style="{lab}">Pratinjau</span>
<div style="display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 14px; background: {c['page']}; border: 1px solid {c['border']};">
<div style="width: {CW*scale:.0f}px; height: {ph:.0f}px; overflow: hidden;"><div style="width: {CW}px; transform: scale({scale}); transform-origin: 0 0;">{prev_h}</div></div>
<div style="width: {CW*scale:.0f}px; height: {pp:.0f}px; overflow: hidden;"><div style="width: {CW}px; transform: scale({scale}); transform-origin: 0 0;">{prev_p}</div></div>
</div>
</section></div>'''
    return body, 820

FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&amp;family=Nunito:wght@700;800&amp;family=JetBrains+Mono:wght@700&amp;display=swap" rel="stylesheet">'

def dc(title, body, w, h):
    return f'''<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONT}
<style>
body{{margin:0}}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
'''

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "preview"
    boards = []
    sb, sw = settings_board()
    boards.append(("G0-Pengaturan.dc.html", "Pengaturan › Tampilan · pilihan Latar (Sakura terang, Lanskap dipilih)", sb, sw, None))
    for k, name, badge in KINDS:
        for m in ("light", "dark"):
            b, w, h = grid_board(k, m)
            nm = f"G-{k}-{'terang' if m == 'light' else 'gelap'}.dc.html"
            t = f"{name}{' (bawaan)' if badge else ''} · {'terang' if m == 'light' else 'gelap'} — Default · Sakura · Lavender"
            boards.append((nm, t, b, w, h))
    if mode == "preview":
        os.makedirs("preview", exist_ok=True)
        for nm, t, b, w, h in boards:
            open(f"preview/{nm}.html", "w").write(f'<html><head>{FONT}<style>body{{margin:0}}</style></head><body>{b}</body></html>')
        json.dump([[nm, t, w, h] for nm, t, b, w, h in boards], open("preview/index.json", "w"))
        print(len(boards), "boards")
    else:
        out = sys.argv[2]
        meta = json.load(open("preview/index.json"))
        hs = {nm: h for nm, t, w, h in meta}
        for nm, t, b, w, h in boards:
            hh = h or hs[nm]
            open(os.path.join(out, nm), "w").write(dc(t, b, w, hh))
            print(nm, w, hh, len(b))
