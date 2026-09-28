import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-sqlite';

import { db, getAllUsers } from './db.ts'

console.log(getAllUsers())