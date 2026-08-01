'use strict';

const https = require('https');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_INTENT_MODEL || 'qwen3.5:2b';
const CLASSIFIER_TIMEOUT_MS = 8000;

const ALLOWED_INTENTS = new Set([
  'ACKNOWLEDGMENT', 'CASUAL_CONVERSATION', 'HELP_REQUEST', 'STATUS_REQUEST',
  'SHOW_WORK', 'SHOW_LEADS', 'START_STAGE1', 'START_STAGE2', 'START_STAGE3',
  'STAGE_GUIDANCE', 'SHOW_SCRIPT', 'CONTACT_PATH_SELECTION', 'CALL_OUTCOME',
  'RECORD_INFORMATION', 'SHOW_NOTES', 'PLAN_REVIEW', 'PLAN_SELECTION',
  'PLAN_APPROVAL_REQUEST', 'PLAN_CANCEL', 'PAUSE', 'RESUME_DRY_RUN',
  'CANARY_ENABLE_REQUEST', 'ACTIVITY_REQUEST', 'CORRECTION', 'UNKNOWN',
]);

const INTENT_TO_HANDLER = {
  ACKNOWLEDGMENT: 'acknowledge',
  CASUAL_CONVERSATION: 'casual',
  HELP_REQUEST: 'help',
  STATUS_REQUEST: 'status',
  SHOW_WORK: 'showWork',
  SHOW_LEADS: 'showLeads',
  START_STAGE1: 'stage1',
  START_STAGE2: 'stage2',
  START_STAGE3: 'stage3',
  STAGE_GUIDANCE: 'stageGuidance',
  SHOW_SCRIPT: 'showScript',
  CONTACT_PATH_SELECTION: 'contactPath',
  CALL_OUTCOME: 'callOutcome',
  RECORD_INFORMATION: 'recordInfo',
  SHOW_NOTES: 'showNotes',
  PLAN_REVIEW: 'planReview',
  PLAN_SELECTION: 'planSelection',
  PLAN_APPROVAL_REQUEST: 'planApproval',
  PLAN_CANCEL: 'planCancel',
  PAUSE: 'pause',
  RESUME_DRY_RUN: 'resume',
  CANARY_ENABLE_REQUEST: 'canaryEnable',
  ACTIVITY_REQUEST: 'activity',
  CORRECTION: 'correction',
  UNKNOWN: 'unknown',
};

function buildClassifierPrompt(context) {
  const parts = [];
  parts.push('You are a pipeline operations intent classifier. Classify the user message into exactly one intent.');
  parts.push('');
  parts.push('Current state:');
  if (context.killSwitchState) parts.push(`- Kill switch: ${context.killSwitchState}`);
  if (context.currentStage) parts.push(`- Active stage: ${context.currentStage}`);
  if (context.activePlanId) parts.push(`- Active canary plan: ${context.activePlanId}`);
  if (context.pendingQuestion) parts.push(`- Pending question: "${context.pendingQuestion}"`);
  if (context.expectedAnswerType) parts.push(`- Expected answer type: ${context.expectedAnswerType}`);
  if (context.selectedLead) parts.push(`- Selected lead: ${context.selectedLead}`);
  parts.push('');
  parts.push('Available intents:');
  for (const intent of ALLOWED_INTENTS) {
    parts.push(`- ${intent}`);
  }
  parts.push('');
  parts.push('User message:');
  parts.push(`"${context.userMessage}"`);
  parts.push('');
  parts.push('Return ONLY valid JSON with this exact schema:');
  parts.push('{"intent":"INTENT_NAME","confidence":0.95,"entities":{},"referencedItems":[],"requiresClarification":false,"clarificationQuestion":null,"reason":"brief explanation"}');
  parts.push('');
  parts.push('Rules:');
  parts.push('- "visible", "got it", "ok", "okay" with no pending question = ACKNOWLEDGMENT');
  parts.push('- "yes" with pending approval question = PLAN_APPROVAL_REQUEST');
  parts.push('- "yes" with no pending question = ACKNOWLEDGMENT');
  parts.push('- "looks good" = PLAN_REVIEW (never auto-approve)');
  parts.push('- "send them", "approve all three" = PLAN_APPROVAL_REQUEST');
  parts.push('- "stop", "pause", "cancel", "dont send" = PAUSE');
  parts.push('- "show me leads", "what are we working on" = SHOW_LEADS or SHOW_WORK');
  parts.push('- "what does Kayla say" = STAGE_GUIDANCE');
  parts.push('- "show the text", "show the script" = SHOW_SCRIPT');
  parts.push('- "they didnt answer", "no answer" = CALL_OUTCOME');
  parts.push('- "the roof is", "the price is" = RECORD_INFORMATION');
  parts.push('- "no thats wrong", "thats the agent not owner" = CORRECTION');
  parts.push('- "what commands", "help" = HELP_REQUEST');
  parts.push('- "status", "how are we doing" = STATUS_REQUEST');
  parts.push('- "activity", "what happened today" = ACTIVITY_REQUEST');
  parts.push('- "resume", "start dry run" = RESUME_DRY_RUN');
  parts.push('- "canary", "enable canary" = CANARY_ENABLE_REQUEST');
  parts.push('- "cancel plan", "dont send that" = PLAN_CANCEL');
  parts.push('- "who do I call", "who is the contact" = CONTACT_PATH_SELECTION');
  parts.push('- "show notes", "what did we record" = SHOW_NOTES');
  parts.push('- "stage 1", "lead entered" = START_STAGE1');
  parts.push('- "stage 2", "contact made" = START_STAGE2');
  parts.push('- "stage 3", "offer ready" = START_STAGE3');
  parts.push('- "review the plan", "show the plan" = PLAN_REVIEW');
  parts.push('- "select 1 and 3", "pick number 2" = PLAN_SELECTION');
  parts.push('- Anything unclear = UNKNOWN with requiresClarification:true');

  return parts.join('\n');
}

function ollamaRequest(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 256 },
    });

    const url = new URL(OLLAMA_HOST);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: CLASSIFIER_TIMEOUT_MS,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(buf);
          resolve(data.response || '');
        } catch (e) {
          reject(new Error('PARSE_ERROR'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

function validateIntent(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (!ALLOWED_INTENTS.has(parsed.intent)) return null;
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) return null;
  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    entities: parsed.entities || {},
    referencedItems: Array.isArray(parsed.referencedItems) ? parsed.referencedItems : [],
    requiresClarification: Boolean(parsed.requiresClarification),
    clarificationQuestion: parsed.clarificationQuestion || null,
    reason: parsed.reason || '',
    handler: INTENT_TO_HANDLER[parsed.intent] || 'unknown',
  };
}

function deterministicFallback(message, context) {
  const t = message.toLowerCase().trim();

  if (/^(stop|pause|cancel|abort|hold|never mind|don'?t\s*send|do\s*not\s*send)$/i.test(t) ||
      /^(pause\s*outreach|pause\s*everything|cancel\s*that)$/i.test(t)) {
    return { intent: 'PAUSE', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic safety command', handler: 'pause' };
  }

  if (/^(visible|got\s*it|ok|okay|k|kk|cool|nice|thanks|thx|ty)$/i.test(t)) {
    if (context.expectedAnswerType === 'PLAN_APPROVAL' && context.pendingQuestion) {
      return { intent: 'PLAN_APPROVAL_REQUEST', confidence: 0.85, entities: {}, referencedItems: [], requiresClarification: true, clarificationQuestion: 'Did you mean to approve the plan? Please say "approve" or "send them" to confirm.', reason: 'Ambiguous approval-like response', handler: 'planApproval' };
    }
    return { intent: 'ACKNOWLEDGMENT', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic acknowledgment', handler: 'acknowledge' };
  }

  if (/^(yes|yeah|yep|yup|sure|absolutely|definitely)$/i.test(t)) {
    if (context.expectedAnswerType === 'PLAN_APPROVAL' && context.pendingQuestion) {
      return { intent: 'PLAN_APPROVAL_REQUEST', confidence: 0.9, entities: {}, referencedItems: [], requiresClarification: true, clarificationQuestion: 'I understood that as approval. Please confirm: send the canary plan items?', reason: 'Yes with pending approval', handler: 'planApproval' };
    }
    if (context.expectedAnswerType === 'YES_NO') {
      return { intent: 'ACKNOWLEDGMENT', confidence: 0.9, entities: { confirmed: true }, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Yes to pending yes/no question', handler: 'acknowledge' };
    }
    return { intent: 'ACKNOWLEDGMENT', confidence: 0.9, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Yes with no pending question', handler: 'acknowledge' };
  }

  if (/^(no|nope|nah|not\s*now)$/i.test(t)) {
    if (context.expectedAnswerType === 'PLAN_APPROVAL') {
      return { intent: 'PLAN_CANCEL', confidence: 0.9, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'No to pending approval', handler: 'planCancel' };
    }
    return { intent: 'ACKNOWLEDGMENT', confidence: 0.9, entities: { confirmed: false }, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'No response', handler: 'acknowledge' };
  }

  if (/^(help|what\s*commands|show\s*commands|what\s*can\s*you\s*do)$/i.test(t)) {
    return { intent: 'HELP_REQUEST', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic help request', handler: 'help' };
  }

  if (/^(status|how\s*are\s*we\s*doing|what'?s?\s*the\s*status)$/i.test(t)) {
    return { intent: 'STATUS_REQUEST', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic status request', handler: 'status' };
  }

  if (/^(activity|what\s*happened\s*today|today'?s?\s*activity)$/i.test(t)) {
    return { intent: 'ACTIVITY_REQUEST', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic activity request', handler: 'activity' };
  }

  if (/^(resume|start\s*dry\s*run|resume\s*dry\s*run)$/i.test(t)) {
    return { intent: 'RESUME_DRY_RUN', confidence: 1.0, entities: {}, referencedItems: [], requiresClarification: false, clarificationQuestion: null, reason: 'Deterministic resume', handler: 'resume' };
  }

  return null;
}

async function classifyIntent(userMessage, context = {}) {
  const fallback = deterministicFallback(userMessage, context);
  if (fallback && fallback.confidence >= 0.9) return fallback;

  try {
    const prompt = buildClassifierPrompt({ ...context, userMessage });
    const response = await ollamaRequest(prompt);
    const parsed = extractJson(response);
    const validated = validateIntent(parsed);

    if (validated) {
      if (fallback && validated.confidence < 0.75) return fallback;
      return validated;
    }

    if (fallback) return fallback;

    return {
      intent: 'UNKNOWN',
      confidence: 0,
      entities: {},
      referencedItems: [],
      requiresClarification: true,
      clarificationQuestion: "I'm not sure what you meant. Are you asking me to review the current leads, continue the open lead, or pause outreach?",
      reason: 'Classifier returned unparseable output',
      handler: 'unknown',
    };
  } catch (e) {
    if (fallback) return fallback;

    return {
      intent: 'UNKNOWN',
      confidence: 0,
      entities: {},
      referencedItems: [],
      requiresClarification: true,
      clarificationQuestion: "I'm not sure what you meant. Are you asking me to review the current leads, continue the open lead, or pause outreach?",
      reason: `Classifier error: ${e.message}`,
      handler: 'unknown',
    };
  }
}

module.exports = {
  classifyIntent,
  ALLOWED_INTENTS,
  INTENT_TO_HANDLER,
  deterministicFallback,
};
