import 'dotenv/config';
import express from 'express';

import { getAllUsers } from './db';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get('/users', (_req, res) => {
  res.json(getAllUsers());
});

app.listen(port, () => {
  console.log(`User service listening on port ${port}`);
});