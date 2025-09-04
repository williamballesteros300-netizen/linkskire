// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const app = express();
app.use(cors());
app.use(express.json());

// --- Configuración ---
const LINKS_FILE = path.resolve(process.cwd(), "links.json");
const DATABASE_URL = process.env.DATABASE_URL || null;
const usingPostgres = Boolean(DATABASE_URL);

// --- Helpers archivo (modo legacy) ---
function cargarLinksFile() {
  try {
    if (!fs.existsSync(LINKS_FILE)) {
      fs.writeFileSync(LINKS_FILE, JSON.stringify({}, null, 2));
    }
    const raw = fs.readFileSync(LINKS_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("Error leyendo links.json:", e);
    return {};
  }
}
function guardarLinksFile(linksObj) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(linksObj, null, 2), "utf8");
}

// --- Helpers comunes ---
function normalizarValor(v) {
  return String(v ?? "").replace(/\D/g, "");
}

// --- Configuración Postgres (si existe DATABASE_URL) ---
let pool = null;
if (usingPostgres) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Si tu URL externa requiere SSL, descomenta:
    ssl: { rejectUnauthorized: false },
  });
}

// Inicializar tabla si usamos Postgres
async function initDB() {
  if (!usingPostgres) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      valor INTEGER NOT NULL,
      url TEXT NOT NULL,
      usado BOOLEAN NOT NULL DEFAULT FALSE,
      creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (valor, url)
    );
    CREATE INDEX IF NOT EXISTS idx_links_valor_usado ON links (valor, usado);
  `;
  await pool.query(sql);
  console.log("✅ Tabla links lista (Postgres)");
}

// Llamada a init si aplica
if (usingPostgres) {
  initDB().catch((err) => {
    console.error("Error iniciando DB:", err);
    process.exit(1);
  });
}

// ----------------- RUTAS (mismo contrato que tenías) -----------------

app.get("/health", (_req, res) => res.json({ ok: true }));

// estado-links -> cantidad disponibles por valor
app.get("/estado-links", async (_req, res) => {
  try {
    if (usingPostgres) {
      const { rows } = await pool.query(
        "SELECT valor, COUNT(*)::int AS total FROM links WHERE usado = FALSE GROUP BY valor ORDER BY valor"
      );
      const estado = {};
      for (const r of rows) estado[String(r.valor)] = r.total;
      return res.json(estado);
    } else {
      const linksPorValor = cargarLinksFile();
      const estado = {};
      for (const [valor, lista] of Object.entries(linksPorValor)) {
        estado[valor] = Array.isArray(lista) ? lista.length : 0;
      }
      return res.json(estado);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// listar-todos -> devuelve objeto { valor: [links...] }
app.get("/listar-todos", async (_req, res) => {
  try {
    if (usingPostgres) {
      const { rows } = await pool.query(
        "SELECT valor, url FROM links WHERE usado = FALSE ORDER BY valor, id"
      );
      const out = {};
      for (const r of rows) {
        const k = String(r.valor);
        if (!out[k]) out[k] = [];
        out[k].push(r.url);
      }
      return res.json(out);
    } else {
      const linksPorValor = cargarLinksFile();
      return res.json(linksPorValor);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// obtener-links/:valor -> lista de links disponibles para ese valor
app.get("/obtener-links/:valor", async (req, res) => {
  try {
    const key = normalizarValor(req.params.valor);
    if (!key) return res.status(400).json({ error: "Valor inválido" });

    if (usingPostgres) {
      const { rows } = await pool.query(
        "SELECT url FROM links WHERE valor = $1 AND usado = FALSE ORDER BY id",
        [Number(key)]
      );
      return res.json({ links: rows.map(r => r.url) });
    } else {
      const linksPorValor = cargarLinksFile();
      const lista = Array.isArray(linksPorValor[key]) ? linksPorValor[key] : [];
      return res.json({ links: lista });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// agregar-links -> { valor, links: [] }
app.post("/agregar-links", async (req, res) => {
  try {
    let { valor, links } = req.body;
    if (!valor || !Array.isArray(links)) {
      return res.status(400).json({ error: "Debes enviar { valor, links[] }" });
    }
    const key = normalizarValor(valor);
    if (!key) return res.status(400).json({ error: "Valor inválido" });

    // limpieza
    links = links
      .map((l) => String(l).trim())
      .filter((l) => l && /^https?:\/\//i.test(l));

    if (links.length === 0) {
      return res.status(400).json({ error: "No hay links válidos para agregar" });
    }

    if (usingPostgres) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let agregados = 0;
        for (const url of links) {
          const r = await client.query(
            "INSERT INTO links (valor, url) VALUES ($1, $2) ON CONFLICT (valor, url) DO NOTHING",
            [Number(key), url]
          );
          if (r.rowCount > 0) agregados++;
        }
        await client.query("COMMIT");
        const { rows } = await pool.query(
          "SELECT COUNT(*)::int AS c FROM links WHERE valor = $1 AND usado = FALSE",
          [Number(key)]
        );
        return res.json({
          mensaje: `✅ Agregados ${agregados} links al valor ${Number(key).toLocaleString("es-CO")}`,
          total: rows[0].c,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(e);
        return res.status(500).json({ error: "Error agregando links (DB)" });
      } finally {
        client.release();
      }
    } else {
      const linksPorValor = cargarLinksFile();
      if (!Array.isArray(linksPorValor[key])) linksPorValor[key] = [];
      const setExistentes = new Set(linksPorValor[key]);
      const nuevos = links.filter((l) => !setExistentes.has(l));
      linksPorValor[key].push(...nuevos);
      guardarLinksFile(linksPorValor);
      return res.json({
        mensaje: `✅ Agregados ${nuevos.length} links al valor ${Number(key).toLocaleString("es-CO")}`,
        total: linksPorValor[key].length,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// borrar-links -> borra los links NO usados (disponibles) para ese valor
app.post("/borrar-links", async (req, res) => {
  try {
    const { valor } = req.body;
    const key = normalizarValor(valor);
    if (!key) return res.status(400).json({ error: "Valor inválido" });

    if (usingPostgres) {
      const { rows: prev } = await pool.query(
        "SELECT COUNT(*)::int AS c FROM links WHERE valor = $1 AND usado = FALSE",
        [Number(key)]
      );
      const result = await pool.query("DELETE FROM links WHERE valor = $1 AND usado = FALSE", [Number(key)]);
      return res.json({
        mensaje: `🗑️ Borrados ${prev[0].c} links del valor ${Number(key).toLocaleString("es-CO")}`,
        total: 0,
      });
    } else {
      const linksPorValor = cargarLinksFile();
      const prev = Array.isArray(linksPorValor[key]) ? linksPorValor[key].length : 0;
      linksPorValor[key] = [];
      guardarLinksFile(linksPorValor);
      return res.json({
        mensaje: `🗑️ Borrados ${prev} links del valor ${Number(key).toLocaleString("es-CO")}`,
        total: 0,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// obtener-link -> toma 1 link disponible y lo marca como usado (atómico)
app.post("/obtener-link", async (req, res) => {
  try {
    const { valor } = req.body;
    const key = normalizarValor(valor);
    if (!key) return res.status(400).json({ error: "Valor inválido" });

    if (usingPostgres) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const sel = await client.query(
          `SELECT id, url FROM links
           WHERE valor = $1 AND usado = FALSE
           ORDER BY id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [Number(key)]
        );
        if (sel.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: `No hay links disponibles para ${Number(key).toLocaleString("es-CO")}` });
        }
        const { id, url } = sel.rows[0];
        await client.query("UPDATE links SET usado = TRUE WHERE id = $1", [id]);
        await client.query("COMMIT");
        const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM links WHERE valor = $1 AND usado = FALSE", [Number(key)]);
        return res.json({ url, restantes: rows[0].c });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(e);
        return res.status(500).json({ error: "Error obteniendo link (DB)" });
      } finally {
        client.release();
      }
    } else {
      const linksPorValor = cargarLinksFile();
      const lista = Array.isArray(linksPorValor[key]) ? linksPorValor[key] : [];
      if (lista.length === 0) {
        return res.status(404).json({ error: `No hay links disponibles para ${Number(key).toLocaleString("es-CO")}` });
      }
      const url = lista.shift();
      linksPorValor[key] = lista;
      guardarLinksFile(linksPorValor);
      return res.json({ url, restantes: lista.length });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}  (modo: ${usingPostgres ? "Postgres" : "JSON file"})`);
});





