import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DATABASE,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

export const initTables = async () => {
  try {
    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        institution VARCHAR(100),
        password VARCHAR(100) NOT NULL,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    console.log('Database tables initialized');
  } catch (err) {
    console.error('Failed to initialize database tables:', err);
    throw err;
  }
};

export const connectDB = async () => {
  try {
    await pool.connect();
    console.log('Connected to PostgreSQL database!');

    // Initialize tables after successful connection
    await initTables();
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }
};

export default pool;
