import { describe, it, expect } from 'vitest';
import {
  encodeCommand,
  decodeMessage,
  frameForSerial
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/protocol/commands';
import { COMMANDS } from '../../../../../../../src/main/devices/drivers/loupedeck/lib/constants';

describe('encodeCommand', () => {
  it('encodes a command with no data', () => {
    const buf = encodeCommand(COMMANDS.SERIAL, 1);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(3); // length = header(3) + data(0) = 3
    expect(buf[1]).toBe(COMMANDS.SERIAL);
    expect(buf[2]).toBe(1); // transaction ID
  });

  it('encodes a command with data payload', () => {
    const data = Buffer.from([0xaa, 0xbb]);
    const buf = encodeCommand(COMMANDS.SET_BRIGHTNESS, 5, data);
    expect(buf.length).toBe(5);
    expect(buf[0]).toBe(5); // length = 3 + 2
    expect(buf[1]).toBe(COMMANDS.SET_BRIGHTNESS);
    expect(buf[2]).toBe(5); // transaction ID
    expect(buf[3]).toBe(0xaa);
    expect(buf[4]).toBe(0xbb);
  });

  it('caps length byte at 0xff for large payloads', () => {
    const data = Buffer.alloc(300);
    const buf = encodeCommand(COMMANDS.FRAMEBUFF, 1, data);
    expect(buf[0]).toBe(0xff);
    expect(buf.length).toBe(303); // full buffer still has all data
  });
});

describe('decodeMessage', () => {
  it('decodes a standard message', () => {
    const msg = Buffer.from([0x05, COMMANDS.BUTTON_PRESS, 0x03, 0x09, 0x00]);
    const { length, command, transactionId, payload } = decodeMessage(msg);
    expect(length).toBe(5);
    expect(command).toBe(COMMANDS.BUTTON_PRESS);
    expect(transactionId).toBe(3);
    expect(payload).toEqual(Buffer.from([0x09, 0x00]));
  });

  it('decodes a message with empty payload', () => {
    const msg = Buffer.from([0x03, COMMANDS.TICK, 0x00]);
    const { payload } = decodeMessage(msg);
    expect(payload.length).toBe(0);
  });

  it('payload length is determined by the length byte, not buffer size', () => {
    // Extra trailing bytes should be excluded from payload
    const msg = Buffer.from([0x04, COMMANDS.VERSION, 0x01, 0x05, 0xff, 0xff]);
    const { payload } = decodeMessage(msg);
    expect(payload.length).toBe(1); // length(4) - header(3) = 1
    expect(payload[0]).toBe(0x05);
  });
});

describe('frameForSerial', () => {
  it('frames a small message with 6-byte header', () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    const framed = frameForSerial(data);
    expect(framed[0]).toBe(0x82); // magic byte
    expect(framed[1]).toBe(0x80 + 3); // 0x80 + data length
    expect(framed.length).toBe(6 + 3); // header + data
    // Payload should follow the 6-byte header
    expect(framed.subarray(6)).toEqual(data);
  });

  it('frames a large message (>255 bytes) with 14-byte header', () => {
    const data = Buffer.alloc(300, 0xab);
    const framed = frameForSerial(data);
    expect(framed[0]).toBe(0x82);
    expect(framed[1]).toBe(0xff); // large-message indicator
    expect(framed.readUInt32BE(6)).toBe(300); // length stored at offset 6
    expect(framed.length).toBe(14 + 300);
    expect(framed.subarray(14)).toEqual(data);
  });
});
