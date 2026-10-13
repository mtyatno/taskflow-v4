"""Generate the Alurik app icons (PWA + Tauri Android) from src-tauri/icons/icon-source.png.

The source logo fills its whole canvas, so launchers that crop icons (Android
adaptive icons, maskable PWA icons) cut the logo off. This script lifts the
logo off its light background and places it on a solid white canvas with
padding on every side:

- "any" icons (icon-192/512, apple-touch): logo ~72% of the canvas.
- "maskable" icons and Android adaptive foregrounds: logo ~56%, well inside
  the 80% safe-zone circle, so a circle, squircle or rounded square mask
  never touches it.

Usage: python3 scripts/gen_app_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src-tauri" / "icons" / "icon-source.png"
STATIC = ROOT / "static"
ANDROID = ROOT / "src-tauri" / "icons" / "android"

BG = (255, 255, 255)
ANY_SCALE = 0.72
MASKABLE_SCALE = 0.56


def extract_logo():
    """Return the logo as an RGBA image with a transparent background, cropped to its bounds."""
    src = Image.open(SOURCE).convert("RGB")
    w, h = src.size
    # Average the border pixels to get the (slightly noisy) background colour.
    border = [src.getpixel((x, y)) for x in range(w) for y in (0, h - 1)]
    border += [src.getpixel((x, y)) for y in range(h) for x in (0, w - 1)]
    bg = tuple(sum(p[c] for p in border) / len(border) for c in range(3))

    out = Image.new("RGBA", (w, h))
    px_in, px_out = src.load(), out.load()
    lo, hi = 10.0, 70.0  # distance from bg mapped to alpha 0..1
    for y in range(h):
        for x in range(w):
            p = px_in[x, y]
            d = max(abs(p[c] - bg[c]) for c in range(3))
            a = min(1.0, max(0.0, (d - lo) / (hi - lo)))
            if a <= 0:
                continue
            # Un-blend the background so semi-transparent edges keep the logo colour.
            col = tuple(int(round(min(255, max(0, bg[c] + (p[c] - bg[c]) / a)))) for c in range(3))
            px_out[x, y] = col + (int(round(a * 255)),)
    return out.crop(out.getbbox())


def compose(logo, size, scale, bg=BG):
    """Centre the logo on a solid square canvas; its longest side is scale * size."""
    canvas = Image.new("RGBA", (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    lw, lh = logo.size
    k = scale * size / max(lw, lh)
    resized = logo.resize((max(1, round(lw * k)), max(1, round(lh * k))), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def circle_mask(img):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out


def rounded_mask(img, radius_ratio=0.18):
    mask = Image.new("L", img.size, 0)
    r = round(img.width * radius_ratio)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out


def main():
    logo = extract_logo()

    for size in (192, 512):
        compose(logo, size, ANY_SCALE).save(STATIC / f"icon-{size}.png", optimize=True)
        compose(logo, size, MASKABLE_SCALE).save(STATIC / f"icon-maskable-{size}.png", optimize=True)

    # Tauri Android launcher icons. Legacy icon = 48dp, adaptive foreground = 108dp
    # (only the centre 72dp is visible, and the mask safe zone is a 66dp circle).
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, f in densities.items():
        d = ANDROID / f"mipmap-{name}"
        legacy = round(48 * f)
        fg = round(108 * f)
        rounded_mask(compose(logo, legacy, ANY_SCALE * 0.92)).save(d / "ic_launcher.png", optimize=True)
        circle_mask(compose(logo, legacy, 0.62)).save(d / "ic_launcher_round.png", optimize=True)
        # 72dp visible / 108dp canvas; keep the logo at ~56% of the visible area.
        compose(logo, fg, MASKABLE_SCALE * 72 / 108, bg=None).save(d / "ic_launcher_foreground.png", optimize=True)


if __name__ == "__main__":
    main()
