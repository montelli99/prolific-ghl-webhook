require('dotenv').config({path:'C:/Users/mscott/AI_Workspace/prolificcapital/pipeline/.env'});
const {neon} = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql`UPDATE users SET email = 'montelli@prolific-investments.com' WHERE id = 'montelli'`
  .then(() => console.log('Updated to montelli@prolific-investments.com'))
  .catch(e => console.error(e.message));