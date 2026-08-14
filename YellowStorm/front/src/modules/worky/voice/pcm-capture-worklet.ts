/**
 * AudioWorklet processor source, loaded at runtime via a Blob URL. It taps the
 * mic stream and posts each Float32 frame to the main thread, which downsamples
 * to 16 kHz, encodes to PCM16, and streams it to Gemini Live.
 */
export const PCM_CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;
