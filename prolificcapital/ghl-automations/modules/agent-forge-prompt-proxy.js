'use strict';

const https = require('http');
const crypto = require('crypto');

const AGENT_FORGE_URL = process.env.AGENT_FORGE_URL || 'http://localhost:3000';
const AGENT_FORGE_TIMEOUT = 15000;

const PROFILES = {
  PIPELINE_CONVERSATION: 'pipeline_conversation',
  WORK_PRIORITIZATION: 'work_prioritization',
  KAYLA_PROCESS_EXPLANATION: 'kayla_process_explanation',
  MEMORY_CONFLICT_EXPLANATION: 'memory_conflict_explanation',
  IMPROVEMENT_ANALYSIS: 'improvement_analysis',
};

function callAgentForge(messages, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: opts.model || 'ollama/qwen3.5:2b',
      messages,
      temperature: opts.temperature || 0.1,
      max_tokens: opts.maxTokens || 512,
    });

    const url = new URL(AGENT_FORGE_URL);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 3000,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-AgentForge-Source': 'pipeline-bot',
        'X-AgentForge-Channel': 'telegram-pipeline-389',
        'X-AgentForge-Project': 'prolificcapital',
        'X-AgentForge-Session': opts.sessionId || 'default',
      },
      timeout: AGENT_FORGE_TIMEOUT,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(buf);
          if (data.error) { reject(new Error(data.error.message || 'AGENT_FORGE_ERROR')); return; }
          const content = data.choices?.[0]?.message?.content || '';
          resolve({ content, model: data.model, usage: data.usage, agentforge: data.agentforge });
        } catch (e) { reject(new Error('PARSE_ERROR')); }
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
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

function buildSystemPrompt(profile, context) {
  switch (profile) {
    case PROFILES.PIPELINE_CONVERSATION:
      return `You are a pipeline operations assistant. Respond conversationally based on the provided context. Never suggest sending SMS, making calls, moving stages, or writing to GHL. Current state: kill switch ${context.safety?.killSwitch || 'unknown'}. Active stage: ${context.conversation?.currentStage || 'none'}. Be concise and helpful.`;

    case PROFILES.WORK_PRIORITIZATION:
      return `You are a work prioritization assistant. Given the pipeline state, rank work items by priority: 1) STOP/DNC/compliance, 2) provider uncertainty, 3) inbound replies, 4) active commitments, 5) unfinished sessions, 6) follow-ups, 7) handoff-ready, 8) untouched leads, 9) monitoring. Return JSON: {"items":[{"priority":1,"label":"...","detail":"...","action":"..."}],"summary":"..."}. Never suggest autonomous sends, calls, or stage movements.`;

    case PROFILES.KAYLA_PROCESS_EXPLANATION:
      return `You explain Kayla's operating process based on canonical rules. Reference the course spec and responsibility matrix. Never suggest the operator do something outside their role. Return JSON: {"explanation":"...","canonicalSource":"...","nextStep":"...","operatorRole":"...","closerRole":"..."}.`;

    case PROFILES.MEMORY_CONFLICT_EXPLANATION:
      return `You explain memory conflicts between stored information and current state. Always prefer live safety state and canonical rules over stored memory. Return JSON: {"conflict":"...","resolution":"...","authorityUsed":"...","explanation":"..."}.`;

    case PROFILES.IMPROVEMENT_ANALYSIS:
      return `You analyze operational patterns to identify improvement opportunities. Review the provided friction data and suggest proposals. Never suggest code changes that bypass safety guards. Return JSON: {"patterns":["..."],"suggestions":[{"area":"...","currentBehavior":"...","proposedChange":"...","benefit":"...","risk":"..."}],"summary":"..."}.`;

    default:
      return 'You are a pipeline operations assistant. Be helpful and concise. Never suggest production actions.';
  }
}

async function runProfile(profile, context, opts = {}) {
  const systemPrompt = buildSystemPrompt(profile, context);
  const userMessage = typeof context === 'string' ? context : JSON.stringify(context).slice(0, 2000);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const result = await callAgentForge(messages, opts);
    const parsed = extractJson(result.content);
    return {
      ok: true,
      profile,
      raw: result.content,
      parsed,
      model: result.model,
      agentforge: result.agentforge,
    };
  } catch (e) {
    return {
      ok: false,
      profile,
      error: e.message,
      fallback: true,
    };
  }
}

function isAvailable() {
  return new Promise((resolve) => {
    const url = new URL(AGENT_FORGE_URL);
    const req = https.request({
      hostname: url.hostname, port: url.port || 3000, path: '/health', method: 'GET', timeout: 3000,
    }, (res) => { resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = {
  PROFILES,
  callAgentForge,
  runProfile,
  isAvailable,
};
