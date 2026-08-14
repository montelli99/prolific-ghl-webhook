'use strict';

class OpenAiTranscriptionProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || 'gpt-4o-mini-transcribe';
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async transcribe() {
    if (!this.isConfigured()) {
      return { status: 'failed', reason: 'STT_PROVIDER_NOT_CONFIGURED', provider: 'openai', model: this.model };
    }
    return { status: 'failed', reason: 'STT_PROVIDER_NOT_IMPLEMENTED_IN_ENV', provider: 'openai', model: this.model };
  }
}

module.exports = { OpenAiTranscriptionProvider };
