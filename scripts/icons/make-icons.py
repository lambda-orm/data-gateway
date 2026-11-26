#!/usr/bin/env python3
"""
The icon of the data-gateway-ide (the browser and the desktop app): "λORM" on a blue rounded square, and only "λ" where
"λORM" can't be read (16 to 48 px). The letters are paths taken from Noto Sans Bold (SIL Open Font License), so the
SVGs don't depend on the fonts of who sees them.

Needs fontTools (pip install fonttools), Google Chrome (headless, to rasterize) and Noto Sans Bold
(/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf, or NOTO_SANS_BOLD). From the root of the repository:

    python3 scripts/icons/make-icons.py

writes packages/ide/public/ (favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png) and
packages/ide-desktop/build/ (icon.svg, icon.png 1024, icon.ico, icons/<n>x<n>.png for Linux).
"""
import os
import struct
import subprocess
import sys
import tempfile

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.environ.get('NOTO_SANS_BOLD', '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf')
CHROME = os.environ.get('CHROME', 'google-chrome')
PUBLIC = os.path.join(ROOT, 'packages', 'ide', 'public')
BUILD = os.path.join(ROOT, 'packages', 'ide-desktop', 'build')

font = TTFont(FONT)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm
cap = font['OS/2'].sCapHeight


def text_paths(text, height, center_x, center_y, tracking=0.0):
	"""The letters of text as SVG paths, their cap height `height`, centred on (center_x, center_y)"""
	scale = height / cap
	names = [cmap[ord(c)] for c in text]
	advances = [glyphs[n].width for n in names]
	width = (sum(advances) + tracking * units * (len(names) - 1)) * scale
	x = center_x - width / 2
	baseline = center_y + height / 2
	paths = []
	for name, advance in zip(names, advances):
		pen = SVGPathPen(glyphs)
		glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
		paths.append(pen.getCommands())
		x += (advance + tracking * units) * scale
	return paths, width


def svg(text):
	"""1024 × 1024: the rounded square and its letters (the λ white, ORM a soft blue-white)"""
	if text == 'λ':
		paths, _ = text_paths('λ', 600, 512, 512)
		letters = f'<path fill="#ffffff" d="{paths[0]}"/>'
	else:
		height = 300
		paths, width = text_paths(text, height, 512, 512, tracking=0.01)
		if width > 800:  # never wider than the square allows
			paths, width = text_paths(text, height * 800 / width, 512, 512, tracking=0.01)
		letters = f'<path fill="#ffffff" d="{paths[0]}"/>' + ''.join(f'<path fill="#dbeafe" d="{p}"/>' for p in paths[1:])
	return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset=".55" stop-color="#1d4ed8"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient>
<radialGradient id="light" cx=".25" cy=".15" r=".9"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset=".6" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs>
<rect x="32" y="32" width="960" height="960" rx="216" fill="url(#bg)"/>
<rect x="32" y="32" width="960" height="960" rx="216" fill="url(#light)"/>
<rect x="33.5" y="33.5" width="957" height="957" rx="214.5" fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="3"/>
{letters}
</svg>
'''


def png(svg_text, size):
	"""The SVG rasterized by headless Chrome at size × size, transparent around the square"""
	with tempfile.TemporaryDirectory() as tmp:
		page = os.path.join(tmp, 'icon.html')
		out = os.path.join(tmp, 'icon.png')
		with open(page, 'w') as f:
			f.write(f'<!doctype html><html><body style="margin:0;background:transparent">'
				f'<img src="data:image/svg+xml;base64,{__import__("base64").b64encode(svg_text.encode()).decode()}" width="{size}" height="{size}" style="display:block"></body></html>')
		subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
			'--default-background-color=00000000', f'--window-size={size},{size}', f'--screenshot={out}', f'file://{page}'],
			check=True, capture_output=True)
		with open(out, 'rb') as f:
			return f.read()


def ico(images):
	"""A .ico of PNG images [(size, bytes)]: Windows Vista and later, and every browser"""
	header = struct.pack('<HHH', 0, 1, len(images))
	entries, offset, data = b'', 6 + 16 * len(images), b''
	for size, image in images:
		entries += struct.pack('<BBBBHHII', size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(image), offset)
		offset += len(image)
		data += image
	return header + entries + data


def write(path, content):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, 'wb' if isinstance(content, bytes) else 'w') as f:
		f.write(content)
	print(os.path.relpath(path, ROOT))


def main():
	full, small = svg('λORM'), svg('λ')
	of = lambda size: png(small if size < 64 else full, size)
	sizes = {n: of(n) for n in (16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024)}
	# the browser: the tab shows 16-32 px, so its SVG is the λ; the home screen of a phone, λORM
	write(os.path.join(PUBLIC, 'favicon.svg'), small)
	write(os.path.join(PUBLIC, 'favicon.ico'), ico([(n, sizes[n]) for n in (16, 32, 48)]))
	write(os.path.join(PUBLIC, 'apple-touch-icon.png'), sizes[180])
	write(os.path.join(PUBLIC, 'icon-192.png'), sizes[192])
	write(os.path.join(PUBLIC, 'icon-512.png'), sizes[512])
	# the desktop app: electron-builder takes icon.png (macOS makes its .icns from it), icon.ico (Windows) and icons/
	write(os.path.join(BUILD, 'icon.svg'), full)
	write(os.path.join(BUILD, 'icon.png'), sizes[1024])
	write(os.path.join(BUILD, 'icon.ico'), ico([(n, sizes[n]) for n in (16, 24, 32, 48, 64, 128, 256)]))
	for n in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
		write(os.path.join(BUILD, 'icons', f'{n}x{n}.png'), sizes[n])


if __name__ == '__main__':
	sys.exit(main())
