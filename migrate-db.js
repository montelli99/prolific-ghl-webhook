// migrate-db.js
// Runs schema.sql commands on the Neon Postgres database
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL not found in environment');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const schemaPath = path.join(__dirname, 'schema.sql');

async function migrate() {
  console.log('Reading schema.sql...');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Split schema SQL by semicolons, but filter out empty statements or comments
  const statements = schemaSql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute.`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`Executing statement ${i + 1}/${statements.length}...`);
    try {
      await sql.query(stmt);
    } catch (err) {
      // Ignore "relation already exists" or duplicate indexes/users to make it idempotent
      if (err.message.includes('already exists') || err.message.includes('duplicate key')) {
        console.log(`  [Note] Already exists / skipped: ${err.message.split('\n')[0]}`);
      } else {
        console.error(`  [Error] Failed statement:\n${stmt}\nError:`, err.message);
        process.exit(1);
      }
    }
  }

  console.log('Migration completed successfully!');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
