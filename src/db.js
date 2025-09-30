const { Pool } = require('pg');

// Simplified database connection for Replit
function buildDbConfig() {
  // Support standard PostgreSQL connection strings (Neon, Supabase, Railway, etc.)
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    return {
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };
  }
  
  // Fallback to individual environment variables
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

let pool = null;

function getPool() {
  if (!pool) {
    const config = buildDbConfig();
    console.log('[db] Connecting to database...', { 
      host: config.host || 'connection-string', 
      database: config.database || 'from-url' 
    });
    pool = new Pool(config);
    
    pool.on('error', (err) => {
      console.error('[db] Pool error:', err);
    });
  }
  return pool;
}

async function query(text, params = []) {
  const start = Date.now();
  const pool = getPool();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('[db] Query executed:', { text: text.substring(0, 100), duration: `${duration}ms`, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('[db] Query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
}

async function withTxn(callback) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[db] Connection pool closed');
  }
}

module.exports = {
  query,
  withTxn,
  close,
  getPool
};
