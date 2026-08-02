'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPRESSION_TYPES = Object.freeze([
  'DNC', 'STOP', 'OPT_OUT', 'WRONG_NUMBER',
  'PENDING_REPLY', 'ACTIVE_HUMAN_WORK', 'PRIOR_OUTREACH', 'PROVIDER_UNCERTAIN',
]);

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '..', 'data', 'local-suppression-registry.json');

class LocalSuppressionRegistry {
  constructor(config = {}) {
    this.registryPath = config.registryPath || DEFAULT_REGISTRY_PATH;
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      fs.writeFileSync(this.registryPath, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries: [] }, null, 2));
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
    } catch (_) {
      return { version: 1, createdAt: new Date().toISOString(), entries: [] };
    }
  }

  _write(data) {
    const tmp = this.registryPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, this.registryPath);
  }

  normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return digits;
  }

  addEntry({ phone, type, state, source, sourceEventId, scope = 'PIPELINE', evidence = {} }) {
    if (!SUPPRESSION_TYPES.includes(type)) throw new Error(`INVALID_SUPPRESSION_TYPE: ${type}`);
    if (!['BLOCKED', 'CLEAR', 'UNKNOWN'].includes(state)) throw new Error(`INVALID_STATE: ${state}`);
    const normalized = this.normalizePhone(phone);
    const now = new Date().toISOString();
    const entry = {
      id: crypto.createHash('sha256').update(`${normalized}:${type}:${source}:${now}`).digest('hex').slice(0, 16),
      phone: normalized,
      type,
      state,
      source,
      sourceEventId: sourceEventId || null,
      scope,
      firstObserved: now,
      lastVerified: now,
      evidenceHash: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 16),
      provenance: source,
      supersededBy: null,
      expiresAt: ['DNC', 'STOP', 'OPT_OUT'].includes(type) ? null : undefined,
    };
    const data = this._read();
    data.entries.push(entry);
    this._write(data);
    return entry;
  }

  lookup(phone, type) {
    const normalized = this.normalizePhone(phone);
    const data = this._read();
    const matches = data.entries
      .filter(e => e.phone === normalized && e.type === type && !e.supersededBy)
      .sort((a, b) => b.lastVerified.localeCompare(a.lastVerified));
    if (matches.length === 0) return { state: 'UNKNOWN', reason: 'NO_LOCAL_ENTRY', entries: [] };
    const states = [...new Set(matches.map(e => e.state))];
    if (states.includes('BLOCKED')) {
      return { state: 'BLOCKED', reason: `LOCAL_${type}_BLOCKED_CONFLICTING`, entries: matches, latestEntry: matches[0] };
    }
    if (states.length > 1) {
      return { state: 'UNKNOWN', reason: `LOCAL_${type}_CONFLICTING`, entries: matches, latestEntry: matches[0] };
    }
    const latest = matches[0];
    return { state: latest.state, reason: `LOCAL_${type}_${latest.state}`, entries: matches, latestEntry: latest };
  }

  supersede(entryId, reason) {
    const data = this._read();
    const entry = data.entries.find(e => e.id === entryId);
    if (!entry) throw new Error(`ENTRY_NOT_FOUND: ${entryId}`);
    entry.supersededBy = reason;
    this._write(data);
    return entry;
  }

  getCoverageStart() {
    const data = this._read();
    if (data.entries.length === 0) return null;
    return data.entries.reduce((earliest, e) => e.firstObserved < earliest ? e.firstObserved : earliest, data.entries[0].firstObserved);
  }

  getStats() {
    const data = this._read();
    const active = data.entries.filter(e => !e.supersededBy);
    const byType = {};
    for (const type of SUPPRESSION_TYPES) {
      byType[type] = active.filter(e => e.type === type).length;
    }
    return { totalEntries: data.entries.length, activeEntries: active.length, byType, coverageStart: this.getCoverageStart() };
  }
}

module.exports = { LocalSuppressionRegistry, SUPPRESSION_TYPES };
