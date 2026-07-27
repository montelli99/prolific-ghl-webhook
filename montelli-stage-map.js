const MONTELLI_PIPELINE_ID = 'nSf3NXYVkt8X4PgW9aZ3';

const MONTELLI_STAGES = [
  { id: '7067148a-2ee8-4e5b-93c8-31e0253fea68', name: 'Lead Entered', internalStage: 'LEAD_ENTERED' },
  { id: '934c4c52-4b22-457a-8d10-55ab6600fdee', name: 'Contact Made', internalStage: 'CONTACT_MADE' },
  { id: '3da698e7-aba8-4d4a-b14b-7742f7b44ac7', name: 'Offer Ready', internalStage: 'OFFER_READY' },
  { id: 'eef16a9b-8ca9-43b7-9cad-fb9c352b560d', name: 'Offer Sent', internalStage: 'OFFER_SENT' },
  { id: 'd5375376-26dc-4dc3-9b06-f55178f8a23b', name: 'Offer Received', internalStage: 'OFFER_RECEIVED' },
  { id: '83f2c0df-a9c5-44fe-b42f-46ed60274e66', name: 'Gain Feedback', internalStage: 'GAIN_FEEDBACK' },
  { id: 'b82940e0-e55c-4359-98e6-35cb22e065ab', name: 'No Answer', internalStage: 'NO_ANSWER' },
  { id: '8dc3463c-8a45-41a1-a305-2013527b1bd8', name: 'Seller Declined', internalStage: 'SELLER_DECLINED' },
  { id: 'a7a5c7ac-3933-4c68-bfce-b81eaacf622e', name: 'Active Negotiation', internalStage: 'ACTIVE_NEGOTIATION' },
  { id: 'e6480e04-1b0f-4f79-af96-7cf5fb634ac5', name: 'Terms Agreed', internalStage: 'TERMS_AGREED' },
  { id: '1e97ae23-78a6-4698-919f-ba0d6a0e08c6', name: 'Awaiting Title', internalStage: 'AWAITING_TITLE' },
  { id: 'f0b739d5-f270-410c-b9e9-bce2e26a53ff', name: 'Contract Out', internalStage: 'CONTRACT_OUT' },
  { id: '645611af-ae9a-4dfc-aba9-8bfff08dc79a', name: 'Under Contract', internalStage: 'UNDER_CONTRACT' },
  { id: 'b68f7087-559d-470b-9ddf-d1452f4b027e', name: 'UC Another Buyer', internalStage: 'UC_ANOTHER_BUYER' },
  { id: '129094e2-ea70-49c1-a670-b599ee25ba3f', name: 'Sent to Buyers', internalStage: 'SENT_TO_BUYERS' },
  { id: 'b7ab06be-9a28-40a2-9dc9-6697fc09a836', name: 'Inspection Complete', internalStage: 'INSPECTION_COMPLETE' },
  { id: '49142ba4-2360-49ca-9a86-6223dc847440', name: 'Appraisal Complete', internalStage: 'APPRAISAL_COMPLETE' },
  { id: '36993fe3-cfc3-4651-99d6-3146627869a3', name: 'JV Sent', internalStage: 'JV_SENT' },
  { id: '6eb610d7-31f2-4380-ab03-fd0c2f771e8b', name: 'JV Signed', internalStage: 'JV_SIGNED' },
  { id: '6f97e402-288e-417a-b561-65a8287e5653', name: 'Wire Setup', internalStage: 'WIRE_SETUP' },
  { id: 'e446607c-2d2c-4664-b0cd-96f9de0584e1', name: 'Closing Date', internalStage: 'CLOSING_DATE' },
];

const MONTELLI_STAGE_MAP = Object.fromEntries(MONTELLI_STAGES.map((stage) => [stage.id, stage.internalStage]));

const MONTELLI_STAGE_NAME_TO_ID = MONTELLI_STAGES.reduce((map, stage) => {
  const key = stage.name.trim().toLowerCase();
  if (map[key]) map[key] = null;
  else map[key] = stage.id;
  return map;
}, {});

function normalizeMontelliStageValue(value) {
  if (!value || typeof value !== 'string') return { stageId: value || '', normalized: false, reason: 'empty' };
  const trimmed = value.trim();
  if (MONTELLI_STAGE_MAP[trimmed]) return { stageId: trimmed, normalized: false, reason: 'uuid' };
  const byName = MONTELLI_STAGE_NAME_TO_ID[trimmed.toLowerCase()];
  if (byName) return { stageId: byName, normalized: true, reason: 'stage_name' };
  if (byName === null) return { stageId: trimmed, normalized: false, reason: 'ambiguous_stage_name' };
  return { stageId: trimmed, normalized: false, reason: 'unknown' };
}

module.exports = {
  MONTELLI_PIPELINE_ID,
  MONTELLI_STAGES,
  MONTELLI_STAGE_MAP,
  normalizeMontelliStageValue,
};
