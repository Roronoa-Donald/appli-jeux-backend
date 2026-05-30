import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sslEnabled = process.env.DATABASE_SSL !== "false";
const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslEnabled ? {
    rejectUnauthorized: false
  } : false
});
