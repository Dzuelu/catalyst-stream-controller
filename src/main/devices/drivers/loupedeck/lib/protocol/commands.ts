import { COMMANDS, type CommandValue } from '../constants';

/**
 * Encode a command + data into a framed packet ready for the transport.
 *
 * Packet format: [length (1 byte, capped at 0xff)] [command] [transactionId] [data...]
 */
export function encodeCommand(command: CommandValue, transactionId: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(3);
  header[0] = Math.min(3 + data.length, 0xff);
  header[1] = command;
  header[2] = transactionId;
  return Buffer.concat([header, data]);
}

/**
 * Decode an incoming message buffer.
 *
 * Returns the command byte, transaction ID, and the payload slice.
 */
export function decodeMessage(buff: Buffer): {
  length: number;
  command: number;
  transactionId: number;
  payload: Buffer;
} {
  return {
    length: buff[0],
    command: buff[1],
    transactionId: buff[2],
    payload: buff.subarray(3, buff[0])
  };
}

/**
 * Wrap a payload buffer with the serial framing header (0x82 magic byte + length).
 * Used by serial transports (both Node and Web Serial).
 */
export function frameForSerial(buff: Buffer): Buffer {
  let prep: Buffer;
  if (buff.length > 0xff) {
    // Large messages: 14-byte header
    prep = Buffer.alloc(14);
    prep[0] = 0x82;
    prep[1] = 0xff;
    prep.writeUInt32BE(buff.length, 6);
  } else {
    // Small messages: 6-byte header
    prep = Buffer.alloc(6);
    prep[0] = 0x82;
    prep[1] = 0x80 + buff.length;
  }
  return Buffer.concat([prep, buff]);
}

/** All known command values for lookup */
export const COMMAND_VALUES = new Set(Object.values(COMMANDS));
