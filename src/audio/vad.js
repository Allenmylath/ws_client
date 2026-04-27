/**
 * src/audio/vad.js
 *
 * Thin wrapper around @ricky0123/vad-web.
 *
 * REQUIRES the following CDN script to be loaded in index.html
 * BEFORE this module is used:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js"></script>
 *
 * Those scripts expose window.vad.MicVAD.
 * When converting to an npm package, replace with:
 *   import { MicVAD } from '@ricky0123/vad-web';
 *
 * Usage:
 *   const v = new RaviVad({ onSpeechStart: () => client.interrupt('vad') });
 *   await v.start();
 *   v.stop();
 */

const VAD_CDN_ONNX = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const VAD_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/';

export class RaviVad {
  /**
   * @param {object} options
   * @param {function}        options.onSpeechStart  — called when speech detected
   * @param {function}        options.onSpeechEnd    — called when speech ends
   * @param {number}          [options.positiveSpeechThreshold=0.7]
   * @param {number}          [options.negativeSpeechThreshold=0.55]
   * @param {number}          [options.redemptionMs=1400]
   * @param {number}          [options.minSpeechMs=400]
   */
  constructor(options = {}) {
    this._options = options;
    this._vad     = null;
  }

  async start() {
    if (!window.vad?.MicVAD) {
      throw new Error(
        'window.vad not found. Load @ricky0123/vad-web CDN script before calling RaviVad.start()'
      );
    }

    const {
      onSpeechStart = () => {},
      onSpeechEnd   = () => {},
      positiveSpeechThreshold = 0.7,
      negativeSpeechThreshold = 0.55,
      redemptionMs            = 1_400,
      minSpeechMs             = 400,
    } = this._options;

    this._vad = await window.vad.MicVAD.new({
      positiveSpeechThreshold,
      negativeSpeechThreshold,
      redemptionMs,
      minSpeechMs,
      onSpeechStart,
      onSpeechEnd,
      onnxWASMBasePath: VAD_CDN_ONNX,
      baseAssetPath:    VAD_CDN_BASE,
    });

    this._vad.start();
  }

  stop() {
    if (this._vad) {
      try { this._vad.destroy(); } catch (_) {}
      this._vad = null;
    }
  }
}
