import { describe, it, expect } from 'vitest';
import { floatTo16BitPCM, downsampleFloat, int16ToBase64, base64ToInt16 } from './pcmAudio';

describe('pcmAudio', () => {
  it('clamps and scales float samples to int16', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1, 2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(32767); // clamped
  });

  it('downsamples 48k -> 16k by ~1/3 length', () => {
    const out = downsampleFloat(new Float32Array(48000).fill(0.5), 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  it('returns the same buffer when rates match', () => {
    const buf = new Float32Array([0.1, 0.2]);
    expect(downsampleFloat(buf, 16000, 16000)).toBe(buf);
  });

  it('round-trips int16 <-> base64', () => {
    const src = new Int16Array([0, 123, -456, 32767, -32768]);
    expect(Array.from(base64ToInt16(int16ToBase64(src)))).toEqual(Array.from(src));
  });
});
