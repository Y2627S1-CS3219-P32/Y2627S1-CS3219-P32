import express from "express";
import { errorHandler } from "./http-handler/errors.js";
import { httpRouter } from "./http-handler/handlers.js";
import { eventRouter } from "./event-handler/handlers.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(httpRouter);
  app.use(eventRouter);
  app.use(errorHandler);
  return app;
}
