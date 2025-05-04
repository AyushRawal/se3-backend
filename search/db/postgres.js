import pkg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pkg;
dotenv.config();

// Create PostgreSQL connection pool
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DATABASE,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

export const connectDB = async () => {
  try {
    await pool.connect();
    console.log('Connected to PostgreSQL database!');

    // Ensure user info can be accessed by search service
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_search_access (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        search_permissions JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('PostgreSQL tables initialized');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
  }

  // Return connection methods for external use (like health checks)
  return {
    getPool: () => pool,
    query: (text, params) => pool.query(text, params)
  };
};

// Export pool for direct queries
export default pool;
