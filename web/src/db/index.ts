import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import * as relations from "./relations";

// NeonDB serverless driver. The pooled (Pool) driver supports multi-statement
// transactions (used by the Genesis flow). Node runtimes need a WebSocket impl;
// on the Edge/serverless runtime a global WebSocket exists and `ws` is unused.
if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

const globalForDb = globalThis as unknown as { pool: Pool };

const pool =
  globalForDb.pool ||
  new Pool({ connectionString: process.env.DATABASE_URL! });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
