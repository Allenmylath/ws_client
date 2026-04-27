/**
 * src/audio/player.js
 *
 * Gapless PCM playback using scheduled AudioBufferSourceNodes.
 * Server sends 16-bit little-endian PCM at PLAYBACK_RATE (24 kHz).
 *
 * Key behaviours:
 *   enqueue(ArrayBuffer)  — decode Int16 PCM and schedule playback
 *   flush()               — stop all scheduled nodes, return flushed ms
 *   isBusy                — true when there is meaningful audio buffered
 */

const PLAYBACK_RATE             = 24_000;  // Hz — must match server TTS output rate
const IGNORE_AFTER_INTERRUPT_MS = 150;     // discard audio received within this window after flush
const MIN_BUFFER_FOR_INTERRUPT  = 50;      // ms — below this, don't bother interrupting

export class AudioPlayer {
  /**
   * @param {AudioContext} audioCtx
   */
  constructor(audioCtx) {
    this._ctx    = audioCtx;
    this._nextAt = 0;         // next AudioBufferSourceNode start time (AudioContext clock)
    this._srcs   = new Set(); // active source nodes
    this._intAt  = 0;         // performance.now() of last flush
    this._peakMs = 0;         // high-water mark for buffer depth
  }

  /** Current buffered audio depth in milliseconds. */
  get bufferedMs() {
    return Math.max(0, (this._nextAt - this._ctx.currentTime) * 1_000);
  }

  /** True when enough audio is buffered that an interruption is worthwhile. */
  get isBusy() {
    return this.bufferedMs > MIN_BUFFER_FOR_INTERRUPT;
  }

  /** Peak buffer depth seen this session (ms). */
  get peakMs() { return this._peakMs; }

  /**
   * Decode and schedule an audio chunk for gapless playback.
   * Silently dropped if called within IGNORE_AFTER_INTERRUPT_MS of a flush.
   *
   * @param {ArrayBuffer} arrayBuffer  Int16 PCM at PLAYBACK_RATE
   */
  enqueue(arrayBuffer) {
    if (performance.now() - this._intAt < IGNORE_AFTER_INTERRUPT_MS) return;

    const i16 = new Int16Array(arrayBuffer);
    const buf = this._ctx.createBuffer(1, i16.length, PLAYBACK_RATE);
    const ch  = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 32_768;

    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._ctx.destination);
    this._srcs.add(src);
    src.onended = () => this._srcs.delete(src);

    const now = this._ctx.currentTime;
    if (this._nextAt < now) this._nextAt = now;
    src.start(this._nextAt);
    this._nextAt += buf.duration;

    const ms = this.bufferedMs;
    if (ms > this._peakMs) this._peakMs = ms;
  }

  /**
   * Stop all scheduled playback immediately.
   * @returns {number} milliseconds of audio that was flushed
   */
  flush() {
    const ms = this.bufferedMs;
    for (const s of this._srcs) { try { s.stop(); } catch (_) {} }
    this._srcs.clear();
    this._nextAt = 0;
    this._intAt  = performance.now();
    return ms;
  }

  destroy() { this.flush(); }
}
