// migrate-to-postgres.js
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const LINKS_FILE = path.resolve(process.cwd(), "links.json");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Setea DATABASE_URL antes de ejecutar este script");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const raw = fs.readFileSync(LINKS_FILE, "utf8");
  const data = JSON.parse(raw || "{}");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      valor INTEGER NOT NULL,
      url TEXT NOT NULL,
      usado BOOLEAN NOT NULL DEFAULT FALSE,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (valor, url)
    );
  `);

  let inserted = 0;
  for (const [valor, lista] of Object.entries(data)) {
    const v = Number(String(valor).replace(/\D/g, ""));
    if (!v) continue;
    for (const url of lista) {
      const limpio = String(url).trim();
      if (!/^https?:\/\//i.test(limpio)) continue;
      const r = await pool.query(
        "INSERT INTO links (valor, url) VALUES ($1, $2) ON CONFLICT (valor, url) DO NOTHING",
        [v, limpio]
      );
      if (r.rowCount > 0) inserted++;
    }
  }

  console.log(`✅ Migración completada. Links insertados: ${inserted}`);
  await pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
