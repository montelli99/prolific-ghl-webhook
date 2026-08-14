'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_RUNTIME_DIR = path.resolve(__dirname, '..', '..', 'data', 'runtime');
const DEFAULT_WHISPER_BIN = path.join(DEFAULT_RUNTIME_DIR, 'whispercpp-runtime', 'Release', 'whisper-cli.exe');
const DEFAULT_WHISPER_MODEL = path.join(DEFAULT_RUNTIME_DIR, 'whispercpp-models', 'ggml-base.en.bin');

class WhisperCppTranscriptionProvider {
  constructor(options = {}) {
    this.bin = options.bin || process.env.WHISPER_CPP_BIN || DEFAULT_WHISPER_BIN;
    this.model = options.model || process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL;
    this.ffmpeg = options.ffmpeg || process.env.FFMPEG_BIN || 'ffmpeg';
    this.language = options.language || 'en';
    this.threads = options.threads || '8';
    this.tempDir = options.tempDir || path.resolve(__dirname, '..', '..', 'data', 'runtime', 'call-intelligence-temp');
  }

  isConfigured() {
    return Boolean(this.bin && this.model && fs.existsSync(this.bin) && fs.existsSync(this.model));
  }

  preprocess(inputPath) {
    fs.mkdirSync(this.tempDir, { recursive: true });
    const output = path.join(this.tempDir, `${path.basename(inputPath, path.extname(inputPath))}.mono16.wav`);
    const result = spawnSync(this.ffmpeg, ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`FFMPEG_PREPROCESS_FAILED: ${result.stderr || result.stdout}`);
    return output;
  }

  runWhisper(filePath, diarize = false) {
    const outBase = path.join(this.tempDir, `${path.basename(filePath, path.extname(filePath))}${diarize ? '.tdrz' : ''}`);
    const args = ['-m', this.model, '-f', filePath, '-l', this.language, '-oj', '-of', outBase, '-t', this.threads];
    if (diarize) args.push('-di');
    const result = spawnSync(this.bin, args, { encoding: 'utf8', timeout: 10 * 60 * 1000 });
    if (result.status !== 0) throw new Error(`WHISPER_CPP_FAILED: ${result.stderr || result.stdout}`);
    const jsonPath = `${outBase}.json`;
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return { json, jsonPath, stdout: result.stdout || '', stderr: result.stderr || '' };
  }

  normalize(json, diarized = false) {
    const segments = Array.isArray(json.transcription) ? json.transcription.map((segment, index) => ({
      index,
      speaker: diarized ? (segment.speaker_turn_next ? 'speaker_turn' : 'unknown') : 'unknown',
      text: String(segment.text || '').trim(),
      start: segment.offsets?.from != null ? Number(segment.offsets.from) / 100 : null,
      end: segment.offsets?.to != null ? Number(segment.offsets.to) / 100 : null,
    })).filter((segment) => segment.text) : [];
    return {
      status: 'ready',
      provider: 'whisper_cpp',
      model: path.basename(this.model),
      language: this.language,
      text: segments.map((segment) => segment.text).join('\n').trim(),
      segments,
      speakers: diarized ? [{ id: 'speaker_turn', label: 'speaker_turn' }] : [],
      speakerMode: diarized ? 'inferred' : 'none',
      durationSeconds: segments.length ? (segments[segments.length - 1].end || 0) : 0,
      processedAt: new Date().toISOString(),
    };
  }

  cleanup(filePath) {
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }

  async transcribe(input) {
    if (!this.isConfigured()) return { status: 'failed', reason: 'STT_PROVIDER_NOT_CONFIGURED', provider: 'whisper_cpp', model: this.model || null };
    const normalized = this.preprocess(input.filePath);
    try {
      const mono = this.runWhisper(normalized, false);
      const transcript = this.normalize(mono.json, false);
      let diarized = null;
      try {
        const stereo = this.runWhisper(input.filePath, true);
        diarized = this.normalize(stereo.json, true);
        this.cleanup(stereo.jsonPath);
      } catch (_) {}
      this.cleanup(mono.jsonPath);
      return { ...transcript, diarizedTranscript: diarized, normalizedAudioPath: normalized };
    } finally {
      this.cleanup(normalized);
    }
  }
}

module.exports = { WhisperCppTranscriptionProvider };
