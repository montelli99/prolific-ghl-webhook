/**
 * Delivery State Processor for PPC Photo Automation
 * Handles sms.status_updated webhooks from JustCall
 * Updates ppc_photo_automation_state with delivery status
 */

const { Pool } = require('pg');

let pool;

async function initialize(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL required for delivery state processor');
  }
  
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });
  
  // Verify connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[Delivery State Processor] Database connection initialized');
  } finally {
    client.release();
  }
}

/**
 * Handle sms.status_updated webhook from JustCall
 * @param {Object} event - JustCall webhook payload
 */
async function handleSmsStatusUpdated(event) {
  const { data } = event;
  
  if (!data || !data.id) {
    console.warn('[Delivery State Processor] Invalid sms.status_updated event:', event);
    return { success: false, error: 'Invalid event data' };
  }
  
  const messageId = data.id;
  const deliveryStatus = data.delivery_status;
  const contactNumber = data.contact_number;
  const justcallNumber = data.justcall_number;
  const smsDate = data.sms_date;
  const smsTime = data.sms_time;
  
  console.log(`[Delivery State Processor] Processing sms.status_updated for message ${messageId}`);
  console.log(`  delivery_status: ${deliveryStatus}`);
  console.log(`  contact: ${contactNumber}`);
  
  if (!pool) {
    console.error('[Delivery State Processor] Database not initialized');
    return { success: false, error: 'Database not initialized' };
  }
  
  const client = await pool.connect();
  
  try {
    // Check if we have a record for this message ID
    const checkResult = await client.query(
      'SELECT id, justcall_message_id, opportunity_id FROM ppc_photo_automation_state WHERE justcall_message_id = $1',
      [messageId]
    );
    
    if (checkResult.rows.length === 0) {
      console.warn(`[Delivery State Processor] No automation record found for message ${messageId}`);
      // This could be a non-automation SMS, log but don't fail
      return { success: true, action: 'no_record_found' };
    }
    
    const record = checkResult.rows[0];
    const previousStatus = record.delivery_status;
    
    // Update delivery status
    const updateResult = await client.query(
      `UPDATE ppc_photo_automation_state 
       SET delivery_status = $1, 
           delivery_status_updated_at = NOW(),
           last_known_status = $2
       WHERE justcall_message_id = $3
       RETURNING id, opportunity_id`,
      [deliveryStatus, previousStatus, messageId]
    );
    
    console.log(`[Delivery State Processor] Updated message ${messageId} status to ${deliveryStatus}`);
    
    // Handle terminal states
    if (deliveryStatus === 'delivered') {
      console.log(`[Delivery State Processor] Message ${messageId} delivered - opportunity ${record.opportunity_id} ready for Awaiting Photos stage`);
      // Note: Stage movement handled by separate GHL integration
      return { 
        success: true, 
        action: 'delivered',
        opportunityId: record.opportunity_id,
        shouldMoveToAwaitingPhotos: true
      };
    } else if (deliveryStatus === 'undelivered') {
      console.warn(`[Delivery State Processor] Message ${messageId} undelivered - opportunity ${record.opportunity_id} should NOT move to Awaiting Photos`);
      return { 
        success: true, 
        action: 'undelivered',
        opportunityId: record.opportunity_id,
        shouldMoveToAwaitingPhotos: false
      };
    } else if (deliveryStatus === 'sent') {
      console.log(`[Delivery State Processor] Message ${messageId} sent (pending delivery confirmation)`);
      return { 
        success: true, 
        action: 'pending',
        opportunityId: record.opportunity_id,
        shouldMoveToAwaitingPhotos: false
      };
    }
    
    return { success: true, action: 'status_updated', status: deliveryStatus };
    
  } catch (err) {
    console.error('[Delivery State Processor] Database error:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Record initial SMS submission (before delivery confirmation)
 * @param {Object} params - Submission parameters
 */
async function recordSmsSubmission({ justcallMessageId, opportunityId, contactId, phoneNumber }) {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      `INSERT INTO ppc_photo_automation_state 
       (justcall_message_id, opportunity_id, contact_id, phone_number, submitted_at, delivery_status, last_known_status)
       VALUES ($1, $2, $3, $4, NOW(), 'submitted', 'DELIVERY_PENDING')
       ON CONFLICT (justcall_message_id) DO UPDATE SET
       submitted_at = NOW(),
       delivery_status = 'submitted',
       last_known_status = 'DELIVERY_PENDING'
       RETURNING id`,
      [justcallMessageId, opportunityId, contactId, phoneNumber]
    );
    
    console.log(`[Delivery State Processor] Recorded SMS submission for message ${justcallMessageId}`);
    return { success: true, recordId: result.rows[0].id };
  } finally {
    client.release();
  }
}

module.exports = {
  initialize,
  handleSmsStatusUpdated,
  recordSmsSubmission
};
