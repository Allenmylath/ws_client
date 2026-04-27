/**
 * src/audio/worklet.js
 *
 * AudioWorkletProcessor — loaded by capture.js via audioWorklet.addModule().
 * NOT an ES module. No imports or exports.
 */

const CHUNK = 512;

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(0);
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    const merged = new Float32Array(this._buf.length + ch.length);
    merged.set(this._buf);
    merged.set(ch, this._buf.length);
    this._buf = merged;

    while (this._buf.length >= CHUNK) {
      const slice = this._buf.slice(0, CHUNK);
      this._buf   = this._buf.slice(CHUNK);
      const i16   = new Int16Array(CHUNK);
      let peak    = 0;
      for (let i = 0; i < CHUNK; i++) {
        const s = Math.max(-1, Math.min(1, slice[i]));
        i16[i]  = s < 0 ? s * 0x8000 : s * 0x7FFF;
        const a = Math.abs(s);
        if (a > peak) peak = a;
      }
      this.port.postMessage({ pcm: i16.buffer, peak }, [i16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-capture', PCMCapture);
