import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "./schema.js";

export function criarDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
export type Db = ReturnType<typeof criarDb>;
