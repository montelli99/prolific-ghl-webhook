require('dotenv').config({path:'C:/Users/mscott/AI_Workspace/prolificcapital/pipeline/.env'});
const {neon} = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`
  .then(() => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`)
  .then(() => console.log('Auth columns added to users table'))
  .catch(e => console.error(e.message));