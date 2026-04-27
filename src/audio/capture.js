/**
 * src/audio/capture.js
 *
 * Captures microphone audio via AudioWorklet and emits 512-sample
 * Int16 PCM chunks at the AudioContext sample rate (16 kHz).
 *
 * The worklet file (worklet.js) must be served from the same origin.
 * It is loaded via a relative URL resolved from this module's location.
 */

export class MicCapture {
  constructor() {
    this._stream = null;
    this._src    = null;
    this._node   = null;
  }

  /**
   * Request mic access, load the worklet, start streaming chunks.
   *
   * @param {AudioContext} audioCtx
   * @param {function(ArrayBuffer, number): void} onChunk
   *   Called with (pcmBuffer, peakLevel) for each 512-sample chunk.
   */
  async start(audioCtx, onChunk) {
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount:      1,
        echoCancellation:  true,
        noiseSuppression:  true,
        autoGainControl:   true,
      },
      video: false,
    });

    // Resolve worklet.js relative to this module file
    const workletUrl = new URL('./worklet.js', import.meta.url).href;
    await audioCtx.audioWorklet.addModule(workletUrl);

    this._src  = audioCtx.createMediaStreamSource(this._stream);
    this._node = new AudioWorkletNode(audioCtx, 'pcm-capture');
    this._src.connect(this._node);

    this._node.port.onmessage = ({ data }) => onChunk(data.pcm, data.peak);
  }

  /** Stop capture and release mic. */
  stop() {
    if (this._node) {
      this._node.port.onmessage = null;
      this._node.disconnect();
      this._node = null;
    }
    if (this._src) {
      this._src.disconnect();
      this._src = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
  }
}
