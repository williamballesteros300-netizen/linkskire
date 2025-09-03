// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

// Ruta del archivo de persistencia
const LINKS_FILE = path.resolve(process.cwd(), "links.json");

// Utilidades de archivo
function cargarLinks() {
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

function guardarLinks(linksObj) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(linksObj, null, 2), "utf8");
}

function normalizarValor(v) {
  const limpio = String(v).replace(/\D/g, "");
  return limpio;
}

// Endpoints
app.get("/health", (_req, res) => res.json({ ok: true }));

// Ver cuántos links hay por valor
app.get("/estado-links", (_req, res) => {
  const linksPorValor = cargarLinks();
  const estado = {};
  for (const [valor, lista] of Object.entries(linksPorValor)) {
    estado[valor] = Array.isArray(lista) ? lista.length : 0;
  }
  res.json(estado);
});

// 📌 Listar todos los links agrupados por valor
app.get("/listar-todos", (_req, res) => {
  const linksPorValor = cargarLinks();
  res.json(linksPorValor);
});

// 📌 Ver todos los links de un valor específico
app.get("/obtener-links/:valor", (req, res) => {
  const key = normalizarValor(req.params.valor);
  if (!key) return res.status(400).json({ error: "Valor inválido" });

  const linksPorValor = cargarLinks();
  const lista = Array.isArray(linksPorValor[key]) ? linksPorValor[key] : [];

  res.json({ links: lista });
});

// Agregar links a un valor
app.post("/agregar-links", (req, res) => {
  let { valor, links } = req.body;

  if (!valor || !Array.isArray(links)) {
    return res.status(400).json({ error: "Debes enviar { valor, links[] }" });
  }

  const key = normalizarValor(valor);
  if (!key) return res.status(400).json({ error: "Valor inválido" });

  // Limpieza de links: trim, quitar vacíos, aceptar solo http/https
  links = links
    .map((l) => String(l).trim())
    .filter((l) => l && /^https?:\/\//i.test(l));

  if (links.length === 0) {
    return res.status(400).json({ error: "No hay links válidos para agregar" });
  }

  const linksPorValor = cargarLinks();
  if (!Array.isArray(linksPorValor[key])) linksPorValor[key] = [];

  // Evitar duplicados exactos
  const setExistentes = new Set(linksPorValor[key]);
  const nuevos = links.filter((l) => !setExistentes.has(l));
  linksPorValor[key].push(...nuevos);

  guardarLinks(linksPorValor);

  return res.json({
    mensaje: `✅ Agregados ${nuevos.length} links al valor ${Number(key).toLocaleString("es-CO")}`,
    total: linksPorValor[key].length,
  });
});

// Borrar todos los links de un valor
app.post("/borrar-links", (req, res) => {
  let { valor } = req.body;
  const key = normalizarValor(valor);
  if (!key) return res.status(400).json({ error: "Valor inválido" });

  const linksPorValor = cargarLinks();
  const prev = Array.isArray(linksPorValor[key]) ? linksPorValor[key].length : 0;
  linksPorValor[key] = [];
  guardarLinks(linksPorValor);

  return res.json({
    mensaje: `🗑️ Borrados ${prev} links del valor ${Number(key).toLocaleString("es-CO")}`,
    total: 0,
  });
});

// Obtener y consumir un link (elimina de la lista)
app.post("/obtener-link", (req, res) => {
  let { valor } = req.body;
  const key = normalizarValor(valor);
  if (!key) return res.status(400).json({ error: "Valor inválido" });

  const linksPorValor = cargarLinks();
  const lista = Array.isArray(linksPorValor[key]) ? linksPorValor[key] : [];

  if (lista.length === 0) {
    return res.status(404).json({ error: `No hay links disponibles para ${Number(key).toLocaleString("es-CO")}` });
  }

  const url = lista.shift(); // usar y remover
  linksPorValor[key] = lista;
  guardarLinks(linksPorValor);

  return res.json({ url, restantes: lista.length });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});




