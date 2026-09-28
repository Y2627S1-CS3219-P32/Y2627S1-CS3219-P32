/**AI Assistance Disclosure:
Tool: ChatGPT(model: GPT6), date: 2026-09-28
Scope: Generated express server boilerplate
Author review: I validated correctness **/

import "dotenv/config";
import express from "express";

const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Supplier service is running" });
});

app.listen(port, '0.0.0.0', (error) => {
  if (error) {
    throw error;
  }

  console.log(`Supplier service listening on http://localhost:${port}`);
});
