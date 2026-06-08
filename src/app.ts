import express from "express";
import cors from "cors";
import { env } from "./config/env.js";

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
