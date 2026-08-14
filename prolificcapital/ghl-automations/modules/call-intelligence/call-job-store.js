'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.resolve(__dirname, '..', '..', 'data', 'runtime', 'call-intelligence-jobs');

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

class CallJobStore {
  constructor(options = {}) {
    this.dir = options.dir || DEFAULT_DIR;
    this.lockStaleMs = options.lockStaleMs || 5 * 60 * 1000;
  }

  key(callId) {
    if (!callId) throw new Error('CALL_INTELLIGENCE_CALL_ID_REQUIRED');
    return `call-intelligence:${String(callId)}`;
  }

  recordPath(callId) {
    return path.join(this.dir, `${hash(this.key(callId)).slice(0, 32)}.json`);
  }

  load(callId) {
    const file = this.recordPath(callId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  save(callId, record) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.recordPath(callId);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
    return record;
  }

  upsert(callId, updater) {
    const current = this.load(callId);
    const next = updater(current);
    return this.save(callId, next);
  }

  async withLock(callId, fn) {
    fs.mkdirSync(this.dir, { recursive: true });
    const lockPath = `${this.recordPath(callId)}.lock`;
    let fd;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        break;
      } catch (_) {
        if (attempt === 0 && this._isStale(lockPath)) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
        throw new Error('CALL_INTELLIGENCE_LOCKED');
      }
    }
    try {
      return await fn();
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
    }
  }

  _isStale(lockPath) {
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > this.lockStaleMs) return true;
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (!lock.pid) return false;
      try {
        process.kill(Number(lock.pid), 0);
        return false;
      } catch (error) {
        return error.code === 'ESRCH';
      }
    } catch (_) {
      return false;
    }
  }
}

module.exports = { CallJobStore, DEFAULT_DIR };
