import "dotenv/config";

const corsOrigin = (process.env.CORS_ORIGIN ?? " ")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export const env = {
  //nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  cors: corsOrigin,
  backendUrl: process.env.BACKEND_URL
} as const;
