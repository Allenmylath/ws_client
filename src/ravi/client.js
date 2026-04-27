/**
 * src/ravi/client.js
 *
 * RaviClient — browser-side RAVI protocol client.
 *
 * Owns: WebSocket transport, MicCapture (PCM send), AudioPlayer (TTS playback).
 * Does NOT own: VAD. Call client.interrupt('vad') from your VAD onSpeechStart.
 *
 * Usage:
 *   const client = new RaviClient({ onBotLlmText: t => console.log(t) });
 *   await client.connect('wss://host/ws');
 *   client.interrupt('manual');  // from VAD or button
 *   client.disconnect();
 *
 * Callbacks (all optional):
 *   onConnected()
 *   onDisconnected()
 *   onBotReady(data)
 *   onBotStartedSpeaking()
 *   onBotStoppedSpeaking()
 *   onUserStartedSpeaking()
 *   onUserStoppedSpeaking()
 *   onUserTranscript({ text, final, user_id, timestamp })
 *   onBotLlmStarted()
 *   onBotLlmStopped()
 *   onBotLlmText(text)
 *   onBotTranscript(text)
 *   onInterrupt(source, flushedMs, count)
 *   onTurn(n, latencyMs)
 *   onAudioLevel(peak 0–1)
 *   onError(message)
 *   onLog(message, level)
 */

import { RAVI_LABEL, RaviMessages } from './messages.js';
import { AudioPlayer }              from '../audio/player.js';
import { MicCapture }               from '../audio/capture.js';

export class RaviClient {
  constructor(callbacks = {}) {
    this._cb = callbacks;

    this._ws       = null;
    this._audioCtx = null;
    this._player   = null;
    this._capture  = null;

    this._running    = false;
    this._receiving  = false;
    this._turnCount  = 0;
    this._intCount   = 0;
    this._lastSendAt = 0;
  }

  // ---- Public API ----

  get isRunning()      { return this._running; }
  get turnCount()      { return this._turnCount; }
  get interruptCount() { return this._intCount; }
  get bufferedMs()     { return this._player?.bufferedMs ?? 0; }
  get peakMs()         { return this._player?.peakMs ?? 0; }
  get isBotSpeaking()  { return this._player?.isBusy ?? false; }

  /**
   * Connect to the rustvani WebSocket server and start mic capture.
   * @param {string} url  e.g. 'wss://host/ws'
   */
  async connect(url) {
    this._audioCtx = new AudioContext({ sampleRate: 16_000 });
    this._player   = new AudioPlayer(this._audioCtx);
    this._capture  = new MicCapture();

    await this._capture.start(this._audioCtx, (pcm, peak) => {
      this._cb.onAudioLevel?.(peak);
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(pcm);
        this._lastSendAt = performance.now();
      }
    });

    await this._connectWs(url);
  }

  /**
   * Interrupt bot playback and notify the server.
   * Call this from your VAD onSpeechStart or any other interrupt source.
   * No-op if the bot is not currently playing audio.
   *
   * @param {string} source  Label for logging e.g. 'vad', 'button'
   * @returns {boolean}      true if an interruption was sent
   */
  interrupt(source = 'manual') {
    if (!this._player?.isBusy) return false;

    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(RaviMessages.clientInterruption());
    }

    const flushedMs = this._player.flush();
    this._intCount++;
    this._receiving = false;
    this._cb.onInterrupt?.(source, flushedMs, this._intCount);
    return true;
  }

  /**
   * Cleanly disconnect: sends disconnect-bot, closes WebSocket, stops audio.
   */
  disconnect() {
    this._running = false;

    this._capture?.stop();
    this._player?.destroy();

    if (this._ws) {
      if (this._ws.readyState === WebSocket.OPEN) {
        try { this._ws.send(RaviMessages.disconnectBot()); } catch (_) {}
        this._ws.close();
      }
      this._ws = null;
    }

    if (this._audioCtx) {
      this._audioCtx.close();
      this._audioCtx = null;
    }

    this._receiving = false;
    this._cb.onDisconnected?.();
  }

  // ---- Private: WebSocket ----

  _connectWs(url) {
    return new Promise((resolve, reject) => {
      const ws      = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this._ws      = ws;

      ws.onopen = () => {
        this._running = true;
        ws.send(RaviMessages.clientReady());
        this._cb.onConnected?.();
        resolve();
      };

      ws.onmessage = evt => this._handleMessage(evt);
      ws.onclose   = ()  => this._onClose();
      ws.onerror   = ()  => {
        this._cb.onError?.('websocket error');
        reject(new Error('WebSocket error'));
      };
    });
  }

  _handleMessage(evt) {
    // ---- Binary: Int16 PCM from TTS ----
    if (evt.data instanceof ArrayBuffer) {
      if (evt.data.byteLength === 0) return;
      if (!this._receiving) {
        this._receiving = true;
        this._turnCount++;
        this._cb.onTurn?.(this._turnCount, performance.now() - this._lastSendAt);
      }
      this._player.enqueue(evt.data);
      return;
    }

    // ---- Text: JSON ----
    let msg;
    try { msg = JSON.parse(evt.data); } catch (_) { return; }

    // Transport-level interruption — no RAVI label, server-side flush signal
    if (msg.type === 'interruption' && msg.label === undefined) {
      const flushedMs = this._player.flush();
      this._intCount++;
      this._receiving = false;
      this._cb.onInterrupt?.('server', flushedMs, this._intCount);
      return;
    }

    if (msg.label !== RAVI_LABEL) return;

    switch (msg.type) {
      case 'bot-ready':
        this._cb.onLog?.(`bot ready — protocol ${msg.data?.version ?? '?'}`, 'ok');
        this._cb.onBotReady?.(msg.data);
        break;
      case 'bot-started-speaking':
        this._receiving = false;
        this._cb.onBotStartedSpeaking?.();
        break;
      case 'bot-stopped-speaking':
        this._cb.onBotStoppedSpeaking?.();
        break;
      case 'user-started-speaking':
        this._cb.onUserStartedSpeaking?.();
        break;
      case 'user-stopped-speaking':
        this._cb.onUserStoppedSpeaking?.();
        break;
      case 'user-transcription':
        this._cb.onUserTranscript?.(msg.data ?? {});
        break;
      case 'bot-llm-started':
        this._cb.onBotLlmStarted?.();
        break;
      case 'bot-llm-stopped':
        this._cb.onBotLlmStopped?.();
        break;
      case 'bot-llm-text':
        this._cb.onBotLlmText?.(msg.data?.text ?? '');
        break;
      case 'bot-transcription':
        this._cb.onBotTranscript?.(msg.data?.text ?? '');
        break;
      case 'error':
        this._cb.onError?.(msg.data?.error ?? 'unknown error');
        break;
      case 'error-response':
        this._cb.onLog?.(`error-response: ${msg.data?.error}`, 'err');
        break;
      default:
        this._cb.onLog?.(`unhandled: ${msg.type}`, 'info');
    }
  }

  _onClose() {
    if (!this._running) return;
    this._running = false;
    this._cb.onDisconnected?.();
  }
}
