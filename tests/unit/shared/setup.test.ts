import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('vitest is working', () => {
    expect(true).toBe(true);
  });

  it('can import shared types', async () => {
    const types = await import('@shared/types');
    expect(types).toBeDefined();
    expect(types.IPC_CHANNELS).toBeDefined();
  });
});
