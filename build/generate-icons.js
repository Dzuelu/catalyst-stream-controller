#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Renders src/main/assets/app-icon.svg into platform icon files:
 *   - build/icon.icns  (macOS — via iconutil)
 *   - build/icon.ico   (Windows — raw ICO binary)
 *   - build/icon.png   (Linux — 512×512 PNG)
 *
 * Requires: node-canvas (already a project dependency), iconutil (macOS).
 * Run:  node build/generate-icons.js
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { execSync } = require('child_process');

const SVG_PATH = path.resolve(__dirname, '../src/main/assets/app-icon.svg');
const BUILD_DIR = path.resolve(__dirname);

async function renderPng(svgDataUrl, size) {
  const img = await loadImage(svgDataUrl);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}

/** Build an ICO file containing multiple PNG images (Vista+ PNG-in-ICO format) */
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * count;
  let dataOffset = headerSize + dirSize;

  const totalSize = dataOffset + pngBuffers.reduce((s, b) => s + b.length, 0);
  const buf = Buffer.alloc(totalSize);

  // ICO header
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type: icon
  buf.writeUInt16LE(count, 4); // image count

  for (let i = 0; i < count; i++) {
    const png = pngBuffers[i];
    const size = sizes[i];
    const offset = headerSize + i * dirEntrySize;

    buf.writeUInt8(size >= 256 ? 0 : size, offset); // width (0 = 256)
    buf.writeUInt8(size >= 256 ? 0 : size, offset + 1); // height
    buf.writeUInt8(0, offset + 2); // color palette
    buf.writeUInt8(0, offset + 3); // reserved
    buf.writeUInt16LE(1, offset + 4); // color planes
    buf.writeUInt16LE(32, offset + 6); // bits per pixel
    buf.writeUInt32LE(png.length, offset + 8); // image data size
    buf.writeUInt32LE(dataOffset, offset + 12); // offset to data

    png.copy(buf, dataOffset);
    dataOffset += png.length;
  }

  return buf;
}

async function main() {
  const svgSource = fs.readFileSync(SVG_PATH, 'utf8');
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgSource).toString('base64')}`;

  console.log('Rendering PNGs from app-icon.svg...');

  // ── macOS .icns ──────────────────────────────────────────
  const iconsetDir = path.join(BUILD_DIR, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);

  const macSizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of macSizes) {
    const png = await renderPng(svgDataUrl, size);
    // Standard resolution
    if (size <= 512) {
      fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}.png`), png);
    }
    // @2x variant (e.g. 32px image → icon_16x16@2x.png)
    const half = size / 2;
    if (half >= 16 && half <= 512) {
      fs.writeFileSync(path.join(iconsetDir, `icon_${half}x${half}@2x.png`), png);
    }
  }

  console.log('Generating icon.icns via iconutil...');
  execSync(`iconutil -c icns -o "${path.join(BUILD_DIR, 'icon.icns')}" "${iconsetDir}"`);
  // Clean up iconset
  fs.rmSync(iconsetDir, { recursive: true });
  console.log('  → build/icon.icns');

  // ── Windows .ico ─────────────────────────────────────────
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    icoPngs.push(await renderPng(svgDataUrl, size));
  }
  const icoBuffer = buildIco(icoPngs, icoSizes);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuffer);
  console.log('  → build/icon.ico');

  // ── Linux .png ───────────────────────────────────────────
  const linuxPng = await renderPng(svgDataUrl, 512);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), linuxPng);
  console.log('  → build/icon.png');

  console.log('Done!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
