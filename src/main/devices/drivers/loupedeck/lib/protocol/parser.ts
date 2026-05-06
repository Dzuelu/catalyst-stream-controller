import { Transform, type TransformCallback } from 'node:stream';

/** Frame parse statistics. */
export interface ParserStats {
  /** Number of complete frames emitted. */
  framesEmitted: number;
  /** Total bytes dropped (data before a magic byte, or incomplete data on flush). */
  bytesDropped: number;
  /** Number of times incomplete data was discarded on stream end. */
  incompleteFlushes: number;
}

/**
 * Parser to split incoming serial data by a magic byte sequence
 * followed by a length byte.
 *
 * Frame format: [magicByte] [length] [payload ... length bytes]
 *
 * Improvements over the original JS implementation:
 * - Tracks bytes dropped before magic bytes (misaligned / corrupted data)
 * - Emits `'drop'` events with the discarded buffer for diagnostics
 * - Does **not** push incomplete frames on stream end (flush)
 * - Provides parse statistics via the {@link stats} getter
 */
export class MagicByteLengthParser extends Transform {
  private delimiter: number;
  private buf: Buffer;
  private _stats: ParserStats = { framesEmitted: 0, bytesDropped: 0, incompleteFlushes: 0 };

  constructor({ magicByte }: { magicByte: number }) {
    super();
    this.delimiter = magicByte;
    this.buf = Buffer.alloc(0);
  }

  /** Read-only snapshot of current parse statistics. */
  get stats(): Readonly<ParserStats> {
    return { ...this._stats };
  }

  override _transform(chunk: Buffer, _encoding: string, cb: TransformCallback): void {
    let data = Buffer.concat([this.buf, chunk]);
    let position: number;
    while ((position = data.indexOf(this.delimiter)) !== -1) {
      // Any bytes before the magic byte are misaligned — drop them
      if (position > 0) {
        const dropped = data.subarray(0, position);
        this._stats.bytesDropped += dropped.length;
        this.emit('drop', dropped);
        data = data.subarray(position);
        // Magic byte is now at index 0; fall through to parse
      }
      // We need at least the magic byte + length byte
      if (data.length < 2) break;
      const nextLength = data[1];
      const expectedEnd = nextLength + 2;
      if (data.length < expectedEnd) break;
      this.push(data.subarray(2, expectedEnd));
      this._stats.framesEmitted++;
      data = data.subarray(expectedEnd);
    }
    this.buf = data;
    cb();
  }

  override _flush(cb: TransformCallback): void {
    if (this.buf.length > 0) {
      // Incomplete frame at stream end — drop it, don't push garbage
      this._stats.bytesDropped += this.buf.length;
      this._stats.incompleteFlushes++;
      this.emit('drop', this.buf);
    }
    this.buf = Buffer.alloc(0);
    cb();
  }
}
