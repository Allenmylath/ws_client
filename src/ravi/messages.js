/**
 * src/ravi/messages.js
 *
 * RAVI protocol constants and outbound message builders.
 * Mirrors the Rust-side src/ravi/models.rs builder functions.
 *
 * All builders return a JSON string ready to send over WebSocket.
 */

export const RAVI_LABEL   = 'ravi';
export const RAVI_VERSION = '1.2.0';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function envelope(type, id = null, data = null) {
  const msg = { label: RAVI_LABEL, type, id: id ?? uid() };
  if (data !== null) msg.data = data;
  return JSON.stringify(msg);
}

export const RaviMessages = Object.freeze({

  // ---- Handshake ----

  clientReady(about = {}) {
    return envelope('client-ready', uid(), {
      version: RAVI_VERSION,
      about:   { library: 'rustvani-client', library_version: '0.1.0', ...about },
    });
  },

  botReady(clientReadyId, version = RAVI_VERSION, about = null) {
    return envelope('bot-ready', clientReadyId, { version, about });
  },

  // ---- Control ----

  disconnectBot() {
    return envelope('disconnect-bot');
  },

  errorResponse(clientMsgId, error) {
    return envelope('error-response', clientMsgId, { error });
  },

  error(error, fatal = false) {
    return envelope('error', uid(), { error, fatal });
  },

  // ---- Transport-level (not RAVI envelope) ----
  // Handled by the WebSocket binary arm in axum_websocket_transport.rs

  clientInterruption() {
    return JSON.stringify({ type: 'client_interruption' });
  },

  // ---- Speaking ----

  botStartedSpeaking()  { return envelope('bot-started-speaking'); },
  botStoppedSpeaking()  { return envelope('bot-stopped-speaking'); },
  userStartedSpeaking() { return envelope('user-started-speaking'); },
  userStoppedSpeaking() { return envelope('user-stopped-speaking'); },

  // ---- Transcription ----

  userTranscription(text, userId, timestamp, isFinal) {
    return envelope('user-transcription', null, {
      text, user_id: userId, timestamp, final: isFinal,
    });
  },

  // ---- LLM ----

  botLlmStarted()     { return envelope('bot-llm-started'); },
  botLlmStopped()     { return envelope('bot-llm-stopped'); },
  botLlmText(text)    { return envelope('bot-llm-text',    null, { text }); },
  botTranscription(t) { return envelope('bot-transcription', null, { text: t }); },

  // ---- TTS ----

  botTtsStarted()  { return envelope('bot-tts-started'); },
  botTtsStopped()  { return envelope('bot-tts-stopped'); },
  botTtsText(text) { return envelope('bot-tts-text', null, { text }); },

  // ---- Custom ----

  serverMessage(data) {
    return envelope('server-message', null, data);
  },

  serverResponse(clientMsgId, msgType, data = null) {
    return envelope('server-response', clientMsgId, { t: msgType, d: data });
  },
});
