// telegram-command-router.js
// Atlas Telegram command router — dispatches /commands to the right module.
// Topic-agnostic: works in 1677 (GHL Automations), 1486 (Kayla's Channel),
// 733 (Comps), or anywhere else the bot operates.
//
// Commands:
//   /dashboard            — Live pipeline dashboard
//   /dashboard <topicId>  — Dashboard posted to a specific topic
//   /atlas <market>       — Atlas Deals sourcing + guarded GHL preflight
//   /atlas creative       — Work saved Creative Financing lists in visible browser mode
//   /atlas import-preflight — Dry-run Atlas-to-GHL import preflight
//   /comps <address>      — Run Kayla's comp methodology (writes to GHL if oppId given)
//   /offer <address>      — Run 5-strategy offer calculator
//   /contract <oppId>     — Route to the right PSA template + addenda
//   /pipeline             — Read-only Pipeline review center
//   /outreach <request>   — Kayla-course Telegram outreach dry-run console
//   /help                 — List commands
//
// Invocation:
//   Atlas (OpenClaw): when a message matches /^\\/[a-z]+/ in a known topic,
//   call routeCommand({ command, args, sourceTopicId, sourceMessageId }).
//   The router returns { reply: string, postToTopicId?: string }.
//
// The router does NOT post to Telegram itself — that stays in the OpenClaw
// layer. This keeps the router testable and the Telegram call stack clean.

'use strict';

const path = require('path');
const PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';

const COMMANDS = {
  dashboard: 'Live pipeline dashboard. /dashboard [course|flat] [topicId]',
  atlas: 'Atlas Deals lead sourcing + guarded GHL preflight: /atlas <market> [county] [state] [maxResults]',
  creative: 'Work saved Creative Financing lists in visible browser mode, then guarded GHL preflight: /atlas creative [market] [county] [state] [maxResults]',
  comps: 'Run Kayla comp methodology: /comps <address> [askingPrice] [rent]',
  offer: '5-strategy offer calc: /offer <address> [askingPrice] [rent]',
  contract: 'Route to PSA template: /contract <oppId>',
  pipeline: 'Read-only Pipeline review center: /pipeline [health|queue|outcomes|coverage|quality|calls|readiness|alerts|reports]',
  outreach: 'Kayla-course outreach dry run: /outreach show me 10 agents | preview the first 5 | approve these for dry run',
  kayla: 'Alias for /outreach natural-language dry-run requests',
  help: 'List all commands',
};

// Lazy module loads (deferred so the router is cheap to import)
function _getDashboard() { return require(path.join(__dirname, 'pipeline-dashboard.js')); }
function _getAtlasDeals() { return require(path.join(__dirname, 'atlas-deals.js')); }
function _getAtlasGhlImport() { return require(path.join(__dirname, 'atlas-ghl-import.js')); }
function _getAtlasGhlReadOnlyClient() { return require(path.join(__dirname, 'atlas-ghl-readonly-client.js')); }
function _getComps()     { return require(path.join(__dirname, 'comps.js')); }
function _getOffer()     { return require(path.join(__dirname, 'offer-calculator.js')); }
function _getContracts() { return require(path.join(__dirname, 'contract-templates.js')); }
function _getPipelineReview() { return require(path.join(__dirname, 'pipeline-telegram-review.js')); }
function _getKaylaOutreach() { return require(path.join(__dirname, 'kayla-telegram-outreach.js')); }
function _getCanaryRunbook() { return require(path.join(__dirname, 'supervised-canary-runbook-service.js')); }

/**
 * Parse a message into { command, args }.
 * Accepts: "/comps 123 Main St" -> { command: 'comps', args: '123 Main St' }
 *          "/dashboard"          -> { command: 'dashboard', args: '' }
 * @param {string} text
 * @returns {{command: string, args: string} | null}
 */
function parseCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Support both /slash commands and @bot mention commands
  // /comps 123 Main St  ->  command: 'comps', args: '123 Main St'
  // @Prolificclawd_bot comps 123 Main St  ->  command: 'comps', args: '123 Main St'
  const slashMatch = trimmed.match(/^\/([a-z]+)\s*(.*)$/i);
  if (slashMatch) {
    return { command: slashMatch[1].toLowerCase(), args: slashMatch[2].trim() };
  }
  const mentionMatch = trimmed.match(/^@\S+\s+([a-z]+)\s*(.*)$/i);
  if (mentionMatch) {
    return { command: mentionMatch[1].toLowerCase(), args: mentionMatch[2].trim() };
  }
  if (/\b(?:contact card|my card|send.*card|test.*card|card.*test|card.*deliver|what.*on my card|show.*card)\b/i.test(trimmed)) {
    return { command: 'contactcard', args: trimmed };
  }
  if (/\b(?:group handoff|kayla group|prepare.*group|create.*group|walk.*through.*group|group.*created|handoff.*confirm|gcj|group chat|who will be in the group|show.*group)\b/i.test(trimmed)) {
    return { command: 'grouphandoff', args: trimmed };
  }
  if (/\b(?:kayla|untouched leads|agents due|owners due|show me \d+ agents|show me \d+ owners|who should i call|preview the first|hold \d+|skip \d+|select \d+|approve these|pause outreach|resume outreach|contact made)\b/i.test(trimmed)) {
    return { command: 'outreach', args: trimmed };
  }
  const canary = _getCanaryRunbook();
  const svc = canary.SupervisedCanaryRunbookService ? new canary.SupervisedCanaryRunbookService() : null;
  if (svc && (svc.isTrigger(trimmed) || svc.isReviewQuestion(trimmed) || svc.parseApproval(trimmed) || svc.isSafetyCommand(trimmed) || svc.isProviderConfirmation(trimmed))) {
    return { command: 'canary', args: trimmed };
  }
  return null;
}

/**
 * Route a parsed command. Returns { reply, postToTopicId? }.
 * The OpenClaw bot layer is responsible for sending the reply.
 *
 * @param {object} input
 * @param {string} input.command
 * @param {string} input.args
 * @param {string} [input.sourceTopicId] - Where the command came from (for context)
 * @param {string} [input.targetTopicId] - Where to post the dashboard, if /dashboard
 * @param {string} [input.oppId] - Optional opportunity ID (auto-resolved by Atlas if absent)
 * @param {string|number} [input.telegramUserId] - Immutable Telegram numeric user ID for privileged review commands
 * @param {string|number} [input.chatId] - Telegram chat ID for callback/session binding
 * @param {object} [input.env] - Optional env override for tests
 * @returns {Promise<{reply: string, postToTopicId?: string, replyMarkup?: object}>}
 */
async function routeCommand({ command, args, sourceTopicId, targetTopicId, oppId, telegramUserId, chatId, env, sourceMessageId }) {
  switch (command) {
    case 'help':
      return _handleHelp();
    case 'dashboard':
      return _handleDashboard(args, targetTopicId || sourceTopicId);
    case 'pipeline':
      return _handlePipelineReview(args, { telegramUserId, chatId: chatId || sourceTopicId, env });
    case 'outreach':
    case 'kayla':
      return _handleKaylaOutreach(args, { telegramUserId, chatId: chatId || sourceTopicId, sourceTopicId, env });
    case 'canary':
      return _handleCanary(args, { telegramUserId, chatId: chatId || sourceTopicId, sourceTopicId, env, messageId: sourceMessageId });
    case 'contactcard':
      return _handleContactCard(args, { telegramUserId, chatId: chatId || sourceTopicId, sourceTopicId, env });
    case 'grouphandoff':
      return _handleGroupHandoff(args, { telegramUserId, chatId: chatId || sourceTopicId, sourceTopicId, env });
    case 'atlas':
    case 'creative':
      return _handleAtlasDeals(args, sourceTopicId, env);
    case 'comps':
      return _handleComps(args, oppId);
    case 'offer':
      return _handleOffer(args, oppId);
    case 'contract':
      return _handleContract(args);
    default:
      return {
        reply: `Unknown command /${command}. Try /help for the list.`,
      };
  }
}

function _handleKaylaOutreach(args, ctx) {
  return _getKaylaOutreach().handleKaylaOutreachCommand(ctx, args || 'show outreach state');
}

async function _handleCanary(args, ctx) {
  const service = new (_getCanaryRunbook().SupervisedCanaryRunbookService)();
  const text = args || '';

  if (service.isSafetyCommand(text)) {
    const planId = service.getActivePlanId();
    if (planId) {
      const result = await service.handleCancel(planId);
      return { reply: result.reply };
    }
    return { reply: 'No active plan to cancel. Remaining PAUSED.' };
  }

  const review = service.isReviewQuestion(text);
  if (review) {
    const planId = service.getActivePlanId();
    if (!planId) return { reply: 'No active plan to review. Start by saying "Begin the first supervised canary."' };
    const result = await service.handleReview(planId, text);
    return { reply: result.reply };
  }

  const approval = service.parseApproval(text);
  if (approval && approval.approved) {
    const planId = service.getActivePlanId();
    if (!planId) return { reply: 'No active plan to approve. Start by saying "Begin the first supervised canary."' };
    const result = await service.handleApproval(planId, text, ctx);
    return { reply: result.reply };
  }

  if (service.isProviderConfirmation(text)) {
    return { reply: 'JustCall account confirmed as active and funded. Proceeding with preparation.' };
  }

  const result = await service.beginPreparation(ctx);
  return { reply: result.reply };
}

function _handlePipelineReview(args, ctx) {
  return _getPipelineReview().handlePipelineCommand(ctx, args || 'menu');
}

function _handleHelp() {
  const lines = ['*Atlas Commands*', ''];
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    lines.push(`/${cmd} — ${desc}`);
  }
  lines.push('');
  lines.push('_These work in any topic I operate in (1677 GHL Automations, 1486 Kayla, 733 Comps)._');
  return { reply: lines.join('\n') };
}

async function _handleDashboard(args, defaultTopicId) {
  // args can be: 'course' | 'flat' | '1486' | 'course 1486' | '1486 course'
  let topicId = defaultTopicId;
  let view = 'flat';
  const tokens = (args || '').split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t === 'course' || t === 'flat') view = t;
    else if (/^\d{3,6}$/.test(t)) topicId = t;
  }
  const dash = _getDashboard();
  const opps = await dash.fetchAllOpportunities();
  const message = dash.formatDashboard(opps, { view });
  if (topicId) {
    return {
      reply: message,
      postToTopicId: topicId,
    };
  }
  return { reply: message };
}

async function _handleAtlasDeals(args, sourceTopicId, env) {
  const tokens = (args || '').split(/\s+/).filter(Boolean);
  const importIntent = normalizeAtlasImportIntent(tokens[0]);
  if (importIntent) return _handleAtlasImportIntent(importIntent, tokens.slice(1), env);

  let mode = 'market';
  let working = [...tokens];
  if (working[0] === 'creative' || working[0] === 'creative-lists') {
    mode = 'creative';
    working = working.slice(1);
  }
  const [market = '', county = '', state = '', maxResultsRaw = '50'] = working;
  const maxResults = Number(maxResultsRaw) > 0 ? Number(maxResultsRaw) : 50;

  if (!market && !county && !state) {
    return {
      reply: 'Usage: /atlas <market> [county] [state] [maxResults]\nExample: /atlas Tampa Hillsborough FL 50',
    };
  }

  const atlas = _getAtlasDeals();
  const plan = atlas.buildAtlasDealPlan({ market, county, state, maxResults });
  const browserPlan = atlas.buildBrowserPropWirePlan({ market, county, state, maxResults, mode });

  const sampleBatch = atlas.buildLeadBatch([
    { first_name: 'Sample', last_name: 'Lead', address: '123 Main St', city: market, state, zip: '', dom: 120, source: 'PropWire', notes: 'Sample upload row' },
  ], { market });

  const reply = atlas.formatAtlasDealReply(plan, sampleBatch) +
    `\n\nMode: ${browserPlan.mode === 'creative' ? 'Creative Financing lists' : 'PropWire sourcing'}` +
    '\n\nBrowser path (visible mode): ' + browserPlan.steps.map(step => `\n- ${step}`).join('') +
    '\n\nExtraction rule: if HTML parsing fails, use DOM or network-response capture next. Do not present options or stop.' +
    '\n\nUpload path: guarded GHL import preflight only. Live writes require a separate owner-approved controlled batch.';

  return {
    reply,
    postToTopicId: sourceTopicId || '769',
  };
}

function normalizeAtlasImportIntent(token) {
  const key = String(token || '').toLowerCase();
  const map = {
    status: 'ATLAS_STATUS',
    readiness: 'ATLAS_STATUS',
    ready: 'ATLAS_STATUS',
    dedupe: 'IMPORT_PREFLIGHT',
    'run-dedupe': 'IMPORT_PREFLIGHT',
    'check-leads': 'IMPORT_PREFLIGHT',
    'prepare-leads': 'IMPORT_PREFLIGHT',
    'import-preflight': 'IMPORT_PREFLIGHT',
    preflight: 'IMPORT_PREFLIGHT',
    duplicates: 'SHOW_GHL_DUPLICATES',
    'contact-matches': 'SHOW_CONTACT_MATCHES',
    'opportunity-matches': 'SHOW_OPPORTUNITY_MATCHES',
    blockers: 'SHOW_IMPORT_BLOCKERS',
    'missing-agent-data': 'SHOW_MISSING_AGENT_DATA',
    batch: 'PREPARE_CONTROLLED_BATCH',
    'controlled-batch': 'PREPARE_CONTROLLED_BATCH',
    ledger: 'SHOW_IMPORT_LEDGER',
    technical: 'SHOW_TECHNICAL_DETAILS',
    upload: 'IMPORT_TO_GHL',
    'upload-first-batch': 'UPLOAD_FIRST_BATCH',
    retry: 'RETRY_FAILED_ROWS',
  };
  return map[key] || null;
}

async function _handleAtlasImportIntent(intent, tokens, env) {
  const limitIndex = tokens.findIndex(token => token === '--limit');
  const limit = limitIndex >= 0 ? Number(tokens[limitIndex + 1] || 0) : 10;
  const atlasImport = _getAtlasGhlImport();
  if (intent === 'ATLAS_STATUS') {
    return {
      reply: [
        '*Atlas Guarded Import Status*',
        '',
        'The 272 Atlas leads are locally prepared, not approved for import.',
        'Historical contact-only GHL dedupe found zero contact-address matches, but it did not check opportunities and is not production readiness.',
        'Current guarded validation remains pending until live read-only duplicate checks and LEAD_ENTERED workflow-safety verification complete.',
        '',
        'Legacy dedupe: DISABLED',
        'Upload: NOT AUTHORIZED',
      ].join('\n'),
      postToTopicId: '769',
    };
  }
  const offlineLookupClient = {
    async lookupPropertyContact() {
      return { status: 'PROPERTY_CONTACT_LOOKUP_ERROR', reason: 'Telegram dry-run has no read-only GHL property-address lookup client configured' };
    },
    async lookupContact() {
      return { status: 'CONTACT_LOOKUP_ERROR', reason: 'Telegram dry-run has no read-only GHL lookup client configured' };
    },
    async lookupOpportunity() {
      return { status: 'OPPORTUNITY_LOOKUP_ERROR', reason: 'Telegram dry-run has no read-only GHL lookup client configured' };
    },
  };
  const envSource = env || process.env;
  const token = envSource.GHL_READ_TOKEN || envSource.GHL_PRIVATE_INTEGRATION_TOKEN || envSource.LEADCONNECTOR_TOKEN || envSource.GHL_API_TOKEN || envSource.GHL_TOKEN || envSource.GHL_ACCESS_TOKEN || envSource.GHL_API_KEY;
  const lookupClient = token ? _getAtlasGhlReadOnlyClient().GhlReadOnlyLookupClient.fromEnv(envSource) : offlineLookupClient;
  const result = await atlasImport.handleConversationalIntent(intent, { limit, client: lookupClient });
  return { reply: result.reply, postToTopicId: '769' };
}

async function _handleComps(args, oppId) {
  if (!args) {
    return { reply: 'Usage: /comps <address> [askingPrice] [monthlyRent]\nExample: /comps 123 Main St Atlanta GA 250000 2200' };
  }
  // Parse address + optional price/rent.
  // Supported formats:
  //   /comps 123 Main St Atlanta GA 30309           (address only, zip stays with address)
  //   /comps 123 Main St Atlanta GA 250000 2200       (address, price, rent)
  //   /comps 123 Main St Atlanta GA price:250000 rent:2200  (explicit)
  //
  // Heuristic: if the last two tokens are both 5-7 digit numbers AND
  // the second-to-last is > 99950 (or 6+ digits), treat as price+rent.
  // Otherwise, everything stays as address.
  const tokens = args.split(/\s+/);
  let askingPrice = null;
  let monthlyRent = null;
  let addressTokens = [...tokens];

  // Check for explicit price: / rent: syntax
  const priceIdx = addressTokens.findIndex(t => t.toLowerCase().startsWith('price:'));
  const rentIdx = addressTokens.findIndex(t => t.toLowerCase().startsWith('rent:'));
  if (priceIdx >= 0) {
    const val = addressTokens[priceIdx].split(':')[1];
    askingPrice = val ? Number(val) : null;
    addressTokens.splice(priceIdx, 1);
  }
  if (rentIdx >= 0) {
    // Adjust index if price was removed before it
    const adjustedIdx = priceIdx >= 0 && rentIdx > priceIdx ? rentIdx - 1 : rentIdx;
    const val = addressTokens[adjustedIdx]?.split(':')[1];
    monthlyRent = val ? Number(val) : null;
    addressTokens.splice(adjustedIdx, 1);
  }

  // If no explicit params, try heuristic from end
  if (askingPrice === null && monthlyRent === null && addressTokens.length >= 3) {
    const last = addressTokens[addressTokens.length - 1];
    const prev = addressTokens.length >= 2 ? addressTokens[addressTokens.length - 2] : null;

    // Both last and prev must be numeric
    const lastNum = /^\d+$/.test(last) ? Number(last) : null;
    const prevNum = prev && /^\d+$/.test(prev) ? Number(prev) : null;

    if (lastNum !== null && prevNum !== null && prevNum > 99999) {
      // prev is likely price (6+ digits or > 99999), last is rent
      askingPrice = prevNum;
      monthlyRent = lastNum;
      addressTokens.pop(); // remove rent
      addressTokens.pop(); // remove price
    } else if (lastNum !== null && lastNum > 99999) {
      // Only one big number at end — treat as price only
      askingPrice = lastNum;
      addressTokens.pop();
    }
  }

  const address = addressTokens.join(' ');

  if (!address) {
    return { reply: 'No address found in command. Try: /comps 123 Main St Atlanta GA 250000 2200' };
  }

  const comps = _getComps();
  const compResult = comps.finalizeCompReport({
    address,
    askingPrice,
    monthlyRent,
    source: 'telegram-command',
  });
  const report = compResult.report;

  // Format the comp report inline (no GHL write yet — that needs oppId + writeToGHL)
  const msg = comps.formatForTelegram({
    report,
    ghlOpportunity: compResult.ghlOpportunity,
    status: 'COMP_REPORT_READY (local, not written to GHL)',
  });

  let followUp = '';
  if (oppId) {
    // Caller passed an oppId; offer to write to GHL on confirmation
    followUp = `\n\n_To write this to GHL opportunity \`${oppId}\`, run the same command with the opp ID and I'll handle it._`;
  } else {
    followUp = `\n\n_Pass an opportunity ID to write this comp report to GHL:_ \`/comps ${args} opp:<id>\``;
  }

  return { reply: msg + followUp };
}

async function _handleOffer(args, oppId) {
  if (!args) {
    return { reply: 'Usage: /offer <address> [askingPrice] [monthlyRent]\nExample: /offer 123 Main St 250000 2200' };
  }
  const tokens = args.split(/\s+/);
  const numericTokens = [];
  while (tokens.length > 0 && /^\d+(\.\d+)?$/.test(tokens[tokens.length - 1])) {
    numericTokens.unshift(tokens.pop());
  }
  const address = tokens.join(' ');
  const askingPrice = numericTokens[0] ? Number(numericTokens[0]) : null;
  const monthlyRent = numericTokens[1] ? Number(numericTokens[1]) : null;

  if (!address || !askingPrice) {
    return { reply: 'Need at least address + asking price. Example: /offer 123 Main St Atlanta GA 250000 2200' };
  }

  const offer = _getOffer();
  // Translate the user-facing /offer args into the cash-underwriter field shape.
  // ARV (lowest_aru_comp) is approximated as askingPrice for a quick what-if; the
  // real ARV should come from /comps first. Repair tier defaults to 30 (cosmetic).
  const fields = {
    address,
    aru: askingPrice,            // approximation; refine with /comps
    tier: 30,                    // default cosmetic tier
    sqft: 1500,                  // reasonable default; user can override via /comps
    fee: 20000,                  // WHOLESALE_FEE_DEFAULT per current standard
    monthlyRent: monthlyRent || 0,
  };
  try {
    const result = oppId
      ? await offer.runAllStrategies(oppId, {
          lowest_aru_comp: fields.aru, repair_tier: fields.tier, repair_sqft: fields.sqft,
          wholesale_fee: fields.fee, existing_loan_balance: 0, existing_loan_rate: 0,
          address: fields.address,
        })
      : offer.runAllStrategiesLocal(fields);
    const note = offer.formatAllStrategies(result);
    const truncated = note.length > 3500 ? note.slice(0, 3500) + '\n\n_(truncated, see GHL opportunity for full output)_' : note;
    const caveat = oppId
      ? ''
      : '\n\n_Note: ARV approximated as asking price; run `/comps` first for an accurate ARV. Defaults: repair tier=30 ($/sqft cosmetic), sqft=1500, fee=$20K._';
    return { reply: truncated + caveat };
  } catch (e) {
    return { reply: `Offer calc failed: ${e.message}` };
  }
}

async function _handleContract(args) {
  if (!args) {
    return { reply: 'Usage: /contract <opportunityId>\nLooks up the opp in the Montelli pipeline and routes to the right PSA template + addenda.' };
  }
  return {
    reply: `Contract routing for opportunity \`${args}\` is queued.\n` +
           `To complete this, I need to be invoked with access to \`safePatchOpportunity\` from the integration layer.\n` +
           `For now, this confirms the router received your request. The full route logic lives in \`fillContractForStage12\`.`,
  };
}

function _handleContactCard(args, ctx) {
  const { ContactCardDelivery } = require(path.join(__dirname, 'contact-card-delivery'));
  const { buildSelfTestPreview, loadSelfTestPreview, approveSelfTest, formatPreviewText, verifyCard } = require(path.join(__dirname, 'contact-card-self-test'));
  const delivery = new ContactCardDelivery();
  const readiness = delivery.getReadiness();
  const spec = delivery.loadCardSpec();

  if (!spec) {
    return { reply: 'Contact card specification not found. The card has not been created yet.' };
  }

  const text = (args || '').toLowerCase().trim();

  // Self-test approval
  if (/\b(?:send the contact card test|send it to my test phone|approve the card self-test)\b/i.test(text)) {
    const ownerId = ctx?.telegramUserId || '';
    const approval = approveSelfTest(ownerId, text);
    if (approval.error) {
      return { reply: `Cannot approve: ${approval.message || approval.error}` };
    }
    return {
      reply: 'Contact card self-test approved. The card is ready to send.\n\n' +
             'To execute: the provider must be invoked with the exact approved parameters.\n' +
             'This requires a provider send operation which is not available in this preview context.',
    };
  }

  // Self-test preview
  if (/\b(?:test my.*card|card.*test|send.*card.*test|test.*to my phone)\b/i.test(text)) {
    const ownerId = ctx?.telegramUserId || '';
    const result = buildSelfTestPreview(ownerId);
    if (result.error) {
      return { reply: `Cannot create self-test preview: ${result.message || result.error}` };
    }
    return { reply: formatPreviewText(result.preview) };
  }

  // Show current card
  const f = spec.fields || {};
  const lines = ['*Montelli Contact Card*', ''];
  lines.push(`Name: ${f.fullName?.value || 'N/A'}`);
  lines.push(`Title: ${f.title?.value || 'N/A'}`);
  lines.push(`Company: ${f.company?.value || 'N/A'}`);
  lines.push(`Phone: ${f.primaryPhone?.value || 'N/A'}`);
  lines.push(`Email: ${f.email?.value || 'N/A'}`);
  lines.push(`Website: ${f.website?.value || 'N/A'}`);
  lines.push('');
  lines.push(`Card hash: \`${spec.cardHash || 'N/A'}\``);
  lines.push(`Ready for self-test: ${readiness.readyForSelfTest ? 'Yes' : 'No'}`);
  lines.push(`Ready for production: ${readiness.ready ? 'Yes' : 'No'}`);
  if (readiness.reason) lines.push(`Status: ${readiness.reason}`);
  lines.push('');
  lines.push('To test: "Test my Montelli contact card to my phone."');

  return { reply: lines.join('\n') };
}

function _handleGroupHandoff(args, ctx) {
  const { JustCallGroupHandoff } = require(path.join(__dirname, 'justcall-group-handoff'));
  const handoff = new JustCallGroupHandoff();
  const cap = handoff.getCapability();

  const lines = ['*Kayla Group Handoff*', ''];
  lines.push(`Status: ${cap.classification}`);
  lines.push(`API: ${cap.apiSupported ? 'Available' : 'Not supported'}`);
  lines.push(`App: ${cap.appSupported ? 'Available' : 'Unknown'}`);
  lines.push('');
  lines.push('*Required Participants:*');
  lines.push(`- Montelli Scott (571-601-2619)`);
  lines.push(`- Kayla Mauser (904-447-2520)`);
  lines.push(`- Seller or listing agent (from GHL)`);
  lines.push('');
  lines.push('Seth (LOI) and Jaxon are not group participants.');
  lines.push('');
  lines.push('To prepare: "Prepare the Kayla group handoff."');
  lines.push('To walk through: "Walk me through creating the group."');

  return { reply: lines.join('\n') };
}

module.exports = {
  parseCommand,
  routeCommand,
  COMMANDS,
  PIPELINE_ID,
};
