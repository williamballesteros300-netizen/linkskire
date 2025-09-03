// server.js
import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// 📌 Archivo donde se guardan los links
const LINKS_FILE = "./links.json";

// Función para cargar los links desde el archivo
function cargarLinks() {
  try {
    const data = fs.readFileSync(LINKS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("⚠️ Error cargando links.json:", err);
    return {};
  }
}

// Función para guardar los links después de usarlos
function guardarLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), "utf-8");
}

// 📌 Endpoint para obtener un link
app.post("/obtener-link", (req, res) => {
  const { valor } = req.body;
  if (!valor) {
    return res.status(400).json({ error: "Debes enviar el valor en el body" });
  }

  const linksPorValor = cargarLinks();
  const lista = linksPorValor[valor];

  if (!lista || lista.length === 0) {
    return res
      .status(404)
      .json({ error: `No hay links disponibles para el valor ${valor}` });
  }

  // ✅ Tomamos el primer link y lo eliminamos
  const link = lista.shift();
  guardarLinks(linksPorValor);

  res.json({ url: link });
});

// 📌 Endpoint para ver cuántos links quedan por valor
app.get("/estado-links", (req, res) => {
  const linksPorValor = cargarLinks();
  const estado = {};
  for (const [valor, lista] of Object.entries(linksPorValor)) {
    estado[valor] = lista.length;
  }
  res.json(estado);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
