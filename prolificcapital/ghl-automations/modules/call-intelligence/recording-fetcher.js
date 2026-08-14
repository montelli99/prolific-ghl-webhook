'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TEMP_DIR = path.resolve(__dirname, '..', '..', 'data', 'runtime', 'call-intelligence-temp');

function defaultNow() {
  return Date.now();
}

function detectExt(contentType, pathname) {
  if (/wav/i.test(contentType || '')) return '.wav';
  if (/mpeg|mp3/i.test(contentType || '')) return '.mp3';
  const match = String(pathname || '').match(/\.[a-z0-9]+$/i);
  return match ? match[0] : '.bin';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

class RecordingFetcher {
  constructor(options = {}) {
    this.tempDir = options.tempDir || DEFAULT_TEMP_DIR;
    this.maxBytes = options.maxBytes || 50 * 1024 * 1024;
    this.redirectLimit = options.redirectLimit || 5;
    this.timeoutMs = options.timeoutMs || 30000;
    this.now = options.now || defaultNow;
    this.ttlMs = options.ttlMs || 60 * 60 * 1000;
  }

  async fetch(callId, recordingUrl) {
    if (!recordingUrl) throw new Error('RECORDING_URL_REQUIRED');
    fs.mkdirSync(this.tempDir, { recursive: true });
    return await this._follow(String(callId), recordingUrl, 0, []);
  }

  async _follow(callId, currentUrl, redirects, chain) {
    if (redirects > this.redirectLimit) throw new Error('RECORDING_REDIRECT_LIMIT_EXCEEDED');
    const url = new URL(currentUrl);
    return await new Promise((resolve, reject) => {
      const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'GET', timeout: this.timeoutMs }, (res) => {
        const step = { status: res.statusCode || 0, host: url.hostname, contentType: res.headers['content-type'] || null };
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(this._follow(callId, new URL(res.headers.location, currentUrl).toString(), redirects + 1, [...chain, step]));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`RECORDING_DOWNLOAD_HTTP_${res.statusCode}`));
        }
        const ext = detectExt(res.headers['content-type'], url.pathname);
        const filePath = path.join(this.tempDir, `call-${callId}-${this.now()}${ext}`);
        const ws = fs.createWriteStream(filePath, { flags: 'wx' });
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > this.maxBytes) {
            req.destroy(new Error('RECORDING_TOO_LARGE'));
          }
        });
        res.pipe(ws);
        ws.on('finish', () => {
          ws.close(() => resolve({
            callId: String(callId),
            filePath,
            sizeBytes: size,
            mimeType: res.headers['content-type'] || '',
            extension: ext,
            redirects,
            finalStatus: res.statusCode,
            finalHost: url.hostname,
            chain: [...chain, step],
            sha256: sha256File(filePath),
          }));
        });
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('RECORDING_DOWNLOAD_TIMEOUT')));
      req.end();
    });
  }

  probe(filePath, ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe') {
    const result = spawnSync(ffprobeBin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8' });
    if (result.status !== 0) return { decodable: false, error: result.stderr || result.stdout || 'FFPROBE_FAILED' };
    const parsed = JSON.parse(result.stdout || '{}');
    const stream = (parsed.streams || [])[0] || {};
    const format = parsed.format || {};
    return {
      decodable: true,
      codec: stream.codec_name || null,
      channels: Number(stream.channels || 0),
      sampleRate: Number(stream.sample_rate || 0),
      durationSeconds: Number(format.duration || stream.duration || 0),
      formatName: format.format_name || null,
    };
  }

  cleanup(filePath) {
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }

  cleanupExpired() {
    if (!fs.existsSync(this.tempDir)) return [];
    const removed = [];
    for (const file of fs.readdirSync(this.tempDir)) {
      const full = path.join(this.tempDir, file);
      const stat = fs.statSync(full);
      if (this.now() - stat.mtimeMs > this.ttlMs) {
        fs.rmSync(full, { force: true });
        removed.push(full);
      }
    }
    return removed;
  }
}

module.exports = { RecordingFetcher, DEFAULT_TEMP_DIR };
