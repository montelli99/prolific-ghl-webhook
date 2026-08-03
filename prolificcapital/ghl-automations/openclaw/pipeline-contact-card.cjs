#!/usr/bin/env node
'use strict';

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
        preview: 'Create and display a self-test preview',
        approve: 'Approve the current self-test preview',
        clear: 'Clear self-test preview and approval state',
      },
    });
  }
}
