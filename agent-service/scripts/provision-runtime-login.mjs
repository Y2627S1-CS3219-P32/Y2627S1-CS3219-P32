import pg from 'pg';

const logins = {
  agent_chat: 'agent_chat_login',
  agent_execution: 'agent_execution_login',
  mandate_runtime: 'mandate_login',
};
const role = process.env.RUNTIME_ROLE;
const runtime = new URL(process.env.RUNTIME_DATABASE_URL);
const username = decodeURIComponent(runtime.username);
const password = decodeURIComponent(runtime.password);
if (logins[role] !== username || !password) throw new Error('Invalid runtime database credentials');
const literal = value => `'${value.replaceAll("'", "''")}'`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const found = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
  if (!found.rowCount) await client.query(`CREATE ROLE "${username}" LOGIN`);
  await client.query(`ALTER ROLE "${username}" PASSWORD ${literal(password)}`);
  await client.query(`GRANT "${role}" TO "${username}"`);
  await client.query('COMMIT');
} finally {
  await client.end();
}
