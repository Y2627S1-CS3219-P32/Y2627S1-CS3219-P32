import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const domains = {
  conversation: [
    ['chat_runtime', 'local-chat-only', 'agent_chat'],
    ['execution_runtime', 'local-execution-only', 'agent_execution'],
  ],
  mandate: [['mandate_runtime_login', 'local-mandate-only', 'mandate_runtime']],
};
const logins = domains[process.env.RUNTIME_DOMAIN];
if (!logins) throw new Error('Invalid runtime domain');
await client.connect();
try {
  for (const [name, password, role] of logins) {
    const found = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name]);
    if (!found.rowCount)
      await client.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' IN ROLE ${role}`);
  }
} finally {
  await client.end();
}
