const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'financedb',
  user:     process.env.DB_USER     || 'financeuser',
  password: process.env.DB_PASSWORD || 'financepass',
  max: 10,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
});

module.exports = pool;
