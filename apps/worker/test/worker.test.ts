import { describe, it, expect } from 'vitest';

describe('Worker', () => {
  it('placeholder: worker module exists', async () => {
    const worker = await import('../src/worker');
    expect(worker).toBeDefined();
  });
});
