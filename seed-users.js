require('dotenv').config({path:'C:/Users/mscott/AI_Workspace/prolificcapital/pipeline/.env'});
const {neon} = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  // Create montelli account with password
  const hash = await bcrypt.hash('prolific2026', 10);
  await sql`UPDATE users SET email = 'montelli@prolificcapital.com', password_hash = ${hash}, role = 'admin' WHERE id = 'montelli'`;
  console.log('montelli@prolificcapital.com / prolific2026');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });