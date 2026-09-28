import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-sqlite';

const db = drizzle(process.env.DB_FILE_NAME!);

console.log(db)