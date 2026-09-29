/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-28
    Scope: Express server boilerplate and GET /users
    Author review: Fixed port to 3000
**/

import 'dotenv/config';
import express from 'express';

import { getAllUsers } from './db';

const app = express();
const port = Number(process.env.PORT ?? 3333);

app.get('/users', (_req, res) => {
  res.json(getAllUsers());
});

app.listen(port, () => {
  console.log(`User service listening on port ${port}`);
});