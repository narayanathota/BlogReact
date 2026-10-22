const mysql = require('mysql2/promise');

// Secrets must come from the environment (a Kubernetes Secret in the cluster, a .env file locally).
// There is deliberately no fallback value: the app refuses to start without it.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Provide it through the environment (see .env.example).`);
  }
  return value;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-service',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'bloguser',
  password: requireEnv('DB_PASSWORD'),
  database: process.env.DB_NAME || 'blogdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
});

async function checkDbConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

module.exports = { pool, checkDbConnection };
