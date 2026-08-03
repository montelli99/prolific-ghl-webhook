'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const EXPECTED_SHA256 = '77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065';
const ASSET_FILENAME = 'montelli-scott-divinity-aligned-v2.vcf';
const DOWNLOAD_FILENAME = 'montelli-scott-divinity-aligned.vcf';
const ASSET_PATH = path.join(__dirname, '..', 'public', 'assets', 'contact-cards', ASSET_FILENAME);

const ALLOWED_ASSETS = new Map([
  [`/assets/contact-cards/${ASSET_FILENAME}`, {
    path: ASSET_PATH,
    filename: DOWNLOAD_FILENAME,
    expectedHash: EXPECTED_SHA256,
  }],
]);

function verifyAsset(assetPath) {
  if (!fs.existsSync(assetPath)) return { ok: false, reason: 'ASSET_NOT_FOUND' };
  try {
    const bytes = fs.readFileSync(assetPath);
    if (bytes.length === 0) return { ok: false, reason: 'ASSET_EMPTY' };
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== EXPECTED_SHA256) return { ok: false, reason: 'HASH_MISMATCH', expected: EXPECTED_SHA256.slice(0, 16), actual: hash.slice(0, 16) };
    return { ok: true, hash, size: bytes.length, bytes };
  } catch (e) {
    return { ok: false, reason: 'ASSET_READ_ERROR', message: e.message };
  }
}

const router = express.Router();

router.get('/assets/contact-cards/:filename', (req, res) => {
  const urlPath = `/assets/contact-cards/${req.params.filename}`;
  const asset = ALLOWED_ASSETS.get(urlPath);

  if (!asset) {
    return res.status(404).json({ error: 'Not found' });
  }

  const result = verifyAsset(asset.path);
  if (!result.ok) {
    console.error(`[contact-card-media] asset verification failed: ${result.reason}`);
    return res.status(500).json({ error: 'Asset unavailable' });
  }

  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
  res.setHeader('Content-Length', String(result.size));
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(result.bytes);
});

router.head('/assets/contact-cards/:filename', (req, res) => {
  const urlPath = `/assets/contact-cards/${req.params.filename}`;
  const asset = ALLOWED_ASSETS.get(urlPath);

  if (!asset) {
    return res.status(404).end();
  }

  const result = verifyAsset(asset.path);
  if (!result.ok) {
    return res.status(500).end();
  }

  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
  res.setHeader('Content-Length', String(result.size));
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end();
});

module.exports = { router, verifyAsset, ALLOWED_ASSETS, EXPECTED_SHA256 };
