require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function applyMigrations() {
  try {
    const client = await pool.connect();
    console.log('Connected to database. Checking migrations...');

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS migration_history (
          id SERIAL PRIMARY KEY,
          migration_name TEXT UNIQUE NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (err) {
      console.error('Failed to create migration history table:', err);
      throw err;
    }

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM migration_history WHERE migration_name = $1',
        [file]
      );

      if (rows.length === 0) {
        console.log(`Applying migration: ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query(
            'INSERT INTO migration_history (migration_name) VALUES ($1)',
            [file]
          );
          await client.query('COMMIT');
          console.log(`Successfully applied ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, err);
          throw err;
        }
      } else {
        console.log(`Migration ${file} already applied. Skipping.`);
      }
    }

    console.log('All migrations processed successfully.');
  } catch (err) {
    console.error('Migration process failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigrations();
