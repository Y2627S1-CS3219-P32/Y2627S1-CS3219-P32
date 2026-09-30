/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Express startup after PostgreSQL initialization and error handling
    Author review: Done
**/
import express, { type ErrorRequestHandler } from "express";

import { config } from "./config";
import { initializeDatabase, pool } from "./db";
import { HttpError } from "./errors";
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";

const app = express();

app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(authRoutes);
app.use("/users", usersRoutes);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }

  console.error("[user-service] Request failed", error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

initializeDatabase()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`User service listening on port ${config.port}`);
    });
  })
  .catch(async (error: unknown) => {
    console.error("[user-service] Database initialization failed", error);
    await pool.end();
    process.exitCode = 1;
  });
