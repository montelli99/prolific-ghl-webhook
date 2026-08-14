'use strict';

const { OpenAiTranscriptionProvider } = require('./openai-transcription');
const { WhisperCppTranscriptionProvider } = require('./whispercpp-transcription');

function createDefaultTranscriptionProvider(options = {}) {
  if (options.provider) return options.provider;
  const configured = process.env.CALL_STT_PROVIDER || '';
  if (configured === 'openai') return new OpenAiTranscriptionProvider(options.openai || {});
  const whisper = new WhisperCppTranscriptionProvider(options.whispercpp || {});
  if (configured === 'whisper_cpp' || whisper.isConfigured()) return whisper;
  return new OpenAiTranscriptionProvider(options.openai || {});
}

module.exports = { createDefaultTranscriptionProvider, WhisperCppTranscriptionProvider };
