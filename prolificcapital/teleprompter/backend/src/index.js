require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { STAGES, STAGE_LABELS, OWNERS, STAGE_BUCKETS } = require('./stages');
const { SCRIPTS, renderScript } = require('./scripts');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'teleprompter', stages: STAGES.length, scripts: Object.keys(SCRIPTS).length });
});

// Get all stages
app.get('/api/stages', (req, res) => {
  res.json({
    stages: STAGES,
    labels: STAGE_LABELS,
    owners: OWNERS,
    buckets: STAGE_BUCKETS
  });
});

// Get script for a stage
app.get('/api/script/:stageId', (req, res) => {
  const { stageId } = req.params;
  if (!SCRIPTS[stageId]) {
    return res.status(404).json({ error: 'Stage not found', validStages: STAGES });
  }
  // Pass through query params as variables
  const variables = req.query;
  const rendered = renderScript(stageId, variables);
  res.json({
    stage: stageId,
    label: STAGE_LABELS[stageId],
    owner: OWNERS[stageId],
    script: rendered
  });
});

// Render a script with variables (POST for complex payloads)
app.post('/api/script/:stageId/render', (req, res) => {
  const { stageId } = req.params;
  const variables = req.body.variables || {};
  if (!SCRIPTS[stageId]) {
    return res.status(404).json({ error: 'Stage not found' });
  }
  const rendered = renderScript(stageId, variables);
  res.json({
    stage: stageId,
    label: STAGE_LABELS[stageId],
    owner: OWNERS[stageId],
    script: rendered
  });
});

// Get all scripts at once (for preloading)
app.get('/api/scripts', (req, res) => {
  res.json({ scripts: SCRIPTS });
});

// Get next stage
app.get('/api/next-stage/:currentStage', (req, res) => {
  const idx = STAGES.indexOf(req.params.currentStage);
  if (idx === -1) return res.status(404).json({ error: 'Unknown stage' });
  if (idx === STAGES.length - 1) return res.json({ next: null, message: 'Pipeline complete' });
  const next = STAGES[idx + 1];
  res.json({ current: req.params.currentStage, next, label: STAGE_LABELS[next] });
});

app.listen(PORT, () => {
  console.log(`🎙️  Teleprompter backend running on port ${PORT}`);
  console.log(`   ${STAGES.length} stages loaded, ${Object.keys(SCRIPTS).length} scripts ready`);
});
