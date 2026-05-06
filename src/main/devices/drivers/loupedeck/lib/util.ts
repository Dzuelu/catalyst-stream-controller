/** Convert an RGBA pixel array to RGB565 (16-bit, little-endian). */
export function rgba2rgb565(rgba: Uint8Array | Uint8ClampedArray | Buffer, pixelSize: number): Buffer {
  const output = Buffer.alloc(pixelSize * 2);
  for (let i = 0; i < pixelSize * 4; i += 4) {
    const red = rgba[i];
    const green = rgba[i + 1];
    const blue = rgba[i + 2];
    let color = blue >> 3;
    color |= (green & 0xfc) << 3;
    color |= (red & 0xf8) << 8;
    output.writeUInt16LE(color, i / 2);
  }
  return output;
}
