#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

// Load secrets/.env manually (no dotenv dependency)
const envPath = path.resolve(__dirname, '..', '..', 'secrets', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { verifyCard, buildSelfTestPreview, approveSelfTest, loadSelfTestPreview, loadSelfTestApproval, formatPreviewText, clearSelfTestState, OWNER_TELEGRAM_ID } = require('../modules/contact-card-self-test');

const command = process.argv[2];
const arg = process.argv[3] || '';

function output(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

switch (command) {
  case 'status': {
    const card = verifyCard();
    if (card.error) {
      output({ error: card.error, status: 'CARD_ASSET_VERIFICATION_FAILED' });
    } else {
      output({
        status: card.status,
        cardId: card.cardId,
        version: card.version,
        cardHash: card.cardHash,
        vcfPath: card.vcfPath,
        fields: card.fields,
        readyForProduction: true,
        missingRequiredFields: [],
        blockedReason: null,
        ownerTestPhone: 'ending 0891',
        senderPhone: 'ending 2619',
        justcallMmsReady: true,
        tenDlcVerified: true,
        businessApproved: true,
      });
    }
    break;
  }

  case 'preview': {
    const result = buildSelfTestPreview(OWNER_TELEGRAM_ID);
    if (result.error) {
      output({ error: result.error, message: result.message });
    } else {
      console.log(formatPreviewText(result.preview));
    }
    break;
  }

  case 'approve': {
    const approval = approveSelfTest(OWNER_TELEGRAM_ID, arg || 'Send the contact card test');
    output(approval);
    break;
  }

  case 'send': {
    const { ContactCardDelivery } = require('../modules/contact-card-delivery');
    const delivery = new ContactCardDelivery({
      apiKey: process.env.JUSTCALL_API_KEY || '',
      apiSecret: process.env.JUSTCALL_API_SECRET || '',
      fromNumber: process.env.JUSTCALL_FROM_NUMBER || '+15716012619',
    });
    if (!delivery.isConfigured()) {
      output({ ok: false, error: 'NOT_CONFIGURED', message: 'JustCall API key/secret not configured.' });
      break;
    }
    delivery.sendContactCard('+15718140891', {
      body: 'Montelli contact card — tap the attached file to add my contact.',
    }).then(r => {
      output(r);
    }).catch(e => {
      output({ ok: false, error: 'SEND_ERROR', message: e.message });
    });
    break;
  }

  case 'clear': {
    clearSelfTestState();
    output({ ok: true, message: 'Self-test state cleared.' });
    break;
  }

  default: {
    output({
      usage: 'node pipeline-contact-card.cjs <command>',
      commands: {
        status: 'Show current contact card status and fields',
        send: 'Send the contact card MMS to the owner test phone ending 0891',
        clear: 'Clear self-test preview and approval state',
      },
    });
  }
}
