import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

app.use(
  cors({
    origin: env.cors,
    methods: ["GET", "POST"],
    credentials: true
  })
);

app.use(express.json());

app.get("/", (_, res) => {
  res.json({
    name: "backend-realtime",
    status: "running"
  });
});

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/docs", (_, res) => {
  const docsPath = path.resolve(__dirname, "..", "docs", "socket-events.html");
  res.sendFile(docsPath);
});
