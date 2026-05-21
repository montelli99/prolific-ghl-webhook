require('dotenv').config({path:'C:/Users/mscott/AI_Workspace/prolificcapital/pipeline/.env'});
const {neon} = require('@neondatabase/serverless');
const {initDb,createLead,advanceLeadStage,updateLead} = require('C:/Users/mscott/AI_Workspace/prolificcapital/pipeline/db');
initDb();

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`DELETE FROM lead_history`;
  await sql`DELETE FROM leads`;

  await createLead('montelli',{address:'1295 Minnesota Ave',price:275000,propertyType:'turnkey',agentName:'Cynthia',agentPhone:'555-0101',population:12000,source:'demo'});

  await createLead('montelli',{address:'3355 E Dashler',price:190000,propertyType:'reno',agentName:'Teresa',agentPhone:'555-0102',population:18000,source:'demo'});
  await advanceLeadStage('montelli','3355 E Dashler','QUALIFIED','Call completed');

  await createLead('montelli',{address:'456 Oak Ave',price:310000,propertyType:'turnkey',agentName:'Mark',agentPhone:'555-0103',population:22000,source:'demo'});
  await advanceLeadStage('montelli','456 Oak Ave','QUALIFIED','Call done');
  await advanceLeadStage('montelli','456 Oak Ave','LOI_REQUESTED','Sent to Seth');

  await createLead('montelli',{address:'789 Pine Blvd',price:240000,propertyType:'turnkey',agentName:'Rachel',agentPhone:'555-0104',population:15000,source:'demo'});
  await advanceLeadStage('montelli','789 Pine Blvd','OFFER_SENT','GCJ sent 5/18');
  await updateLead('montelli','789 Pine Blvd',{followup48hrDue:new Date(Date.now()-3600000).toISOString()});

  await createLead('montelli',{address:'1020 Elm St',price:380000,propertyType:'turnkey',agentName:'David',agentPhone:'555-0105',population:25000,source:'demo'});
  await advanceLeadStage('montelli','1020 Elm St','DEAD','Declined, DOM 142');

  console.log('5 demo leads loaded into Neon');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
