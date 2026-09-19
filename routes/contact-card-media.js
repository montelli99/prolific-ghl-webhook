'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const EXPECTED_SHA256 = '1c50c789d0effaae5036373399715a27464348c91cc47df0405b7057c2adfe82';
const ASSET_FILENAME = 'montelli-scott-divinity-aligned-v2.vcf';
const DOWNLOAD_FILENAME = 'montelli-scott-divinity-aligned.vcf';
const ASSET_PATH = path.join(__dirname, '..', 'public', 'assets', 'contact-cards', ASSET_FILENAME);

const ALLOWED_ASSETS = new Map([
  [`/assets/contact-cards/${ASSET_FILENAME}`, {
    path: ASSET_PATH,
    filename: DOWNLOAD_FILENAME,
    expectedHash: EXPECTED_SHA256,
    contentType: 'text/vcard; charset=utf-8',
  }],
  ['/assets/contact-cards/montelli-no-response-followup.mp3', {
    path: path.join(__dirname, '..', 'public', 'assets', 'contact-cards', 'montelli-no-response-followup.mp3'),
    filename: 'montelli-no-response-followup.mp3',
    expectedHash: '48CF61C1B3209F1603C48B51F69A4D34FB3E69FCFA4D734BE2EC6FB34CB3EA69'.toLowerCase(),
    contentType: 'audio/mpeg',
  }],
  ['/assets/contact-cards/montelli-photo-followup.mp3', {
    path: path.join(__dirname, '..', 'public', 'assets', 'contact-cards', 'montelli-photo-followup.mp3'),
    filename: 'montelli-photo-followup.mp3',
    expectedHash: 'EEF1F4885481D368C983291280350C7AB1EB6CF3AEA62383AEB68BAC6CFA12C3'.toLowerCase(),
    contentType: 'audio/mpeg',
  }],
]);

function verifyAsset(assetPath, expectedHash = null) {
  if (!fs.existsSync(assetPath)) return { ok: false, reason: 'ASSET_NOT_FOUND' };
  try {
    const bytes = fs.readFileSync(assetPath);
    if (bytes.length === 0) return { ok: false, reason: 'ASSET_EMPTY' };
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (expectedHash && hash !== expectedHash) return { ok: false, reason: 'HASH_MISMATCH', expected: expectedHash.slice(0, 16), actual: hash.slice(0, 16) };
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

  const result = verifyAsset(asset.path, asset.expectedHash);
  if (!result.ok) {
    console.error(`[contact-card-media] asset verification failed: ${result.reason}`);
    return res.status(500).json({ error: 'Asset unavailable' });
  }

  res.setHeader('Content-Type', asset.contentType);
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

  const result = verifyAsset(asset.path, asset.expectedHash);
  if (!result.ok) {
    return res.status(500).end();
  }

  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
  res.setHeader('Content-Length', String(result.size));
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end();
});

module.exports = { router, verifyAsset, ALLOWED_ASSETS, EXPECTED_SHA256 };
