import pool from '../db.js';

export const createUser = async ({ name, email, role, institution, password }) => {
  const result = await pool.query(
    `INSERT INTO users (name, email, role, institution, password)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING user_id, name, email, role, institution, join_date`,
    [name, email, role, institution, password]
  );
  return result.rows[0];
};

export const findUserByEmail = async (email) => {
  const result = await pool.query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );
  return result.rows[0];
};

export const findUserById = async (userId) => {
  const result = await pool.query(
    `SELECT * FROM users WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0];
};