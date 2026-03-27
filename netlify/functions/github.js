// ═══════════════════════════════════════════════════════════
// Proxy seguro para a GitHub API.
// Suporta: listar arquivos, upload, delete e SERVIR arquivos
// (necessário para repositórios privados).
// O GITHUB_TOKEN fica em variável de ambiente no Netlify.
// ═══════════════════════════════════════════════════════════

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO;
const BASE         = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const GH_HEADERS = {
  Authorization:          `Bearer ${GITHUB_TOKEN}`,
  Accept:                 "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type":         "application/json",
};

// Mapeia extensão → Content-Type para servir corretamente no browser
const MIME_TYPES = {
  // Web
  html: "text/html; charset=utf-8",
  htm:  "text/html; charset=utf-8",
  css:  "text/css",
  js:   "application/javascript",
  json: "application/json",
  // Documentos
  pdf:  "application/pdf",
  txt:  "text/plain; charset=utf-8",
  md:   "text/plain; charset=utf-8",
  // Imagens
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  svg:  "image/svg+xml",
  ico:  "image/x-icon",
  // Vídeo / Áudio
  mp4:  "video/mp4",
  webm: "video/webm",
  mp3:  "audio/mpeg",
  wav:  "audio/wav",
  // Compactados / genérico
  zip:  "application/zip",
};

function getMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

exports.handler = async (event) => {
  // Pre-flight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "text/plain" }, body: "" };
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Variáveis de ambiente não configuradas." }),
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "list"; // list | serve

  try {

    // ── GET: listar arquivos de uma pasta ──────────────────
    if (event.httpMethod === "GET" && action === "list") {
      const path = params.path || "";
      const res  = await fetch(`${BASE}/${path}`, { headers: GH_HEADERS });

      if (res.status === 404) {
        return {
          statusCode: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify([]),
        };
      }

      const data  = await res.json();
      const files = Array.isArray(data)
        ? data.filter((f) => f.type === "file").map((f) => ({
            name:     f.name,
            path:     f.path,
            sha:      f.sha,
            size:     f.size,
          }))
        : [];

      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(files),
      };
    }

    // ── GET: servir arquivo com Content-Type correto ───────
    // Usado para abrir HTMLs, PDFs, imagens no browser
    if (event.httpMethod === "GET" && action === "serve") {
      const path = params.path || "";
      if (!path) {
        return { statusCode: 400, headers: { ...CORS }, body: "path obrigatório" };
      }

      const res = await fetch(`${BASE}/${path}`, { headers: GH_HEADERS });
      if (!res.ok) {
        return { statusCode: res.status, headers: { ...CORS }, body: "Arquivo não encontrado" };
      }

      const data     = await res.json();
      const content  = data.content; // base64 com \n
      const filename = path.split("/").pop();
      const mime     = getMime(filename);

      // Retorna base64 direto para o Netlify decodificar
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type":        mime,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control":       "private, no-cache",
        },
        body:            content.replace(/\n/g, ""),
        isBase64Encoded: true,
      };
    }

    // ── POST: fazer upload de arquivo ─────────────────────
    if (event.httpMethod === "POST") {
      const { path, content, message } = JSON.parse(event.body);

      if (!path || !content) {
        return {
          statusCode: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "path e content são obrigatórios." }),
        };
      }

      // Verifica SHA existente (necessário para sobrescrever)
      let sha;
      const check = await fetch(`${BASE}/${path}`, { headers: GH_HEADERS });
      if (check.ok) {
        const existing = await check.json();
        sha = existing.sha;
      }

      const payload = { message: message || `Upload: ${path}`, content };
      if (sha) payload.sha = sha;

      const res  = await fetch(`${BASE}/${path}`, {
        method:  "PUT",
        headers: GH_HEADERS,
        body:    JSON.stringify(payload),
      });
      const data = await res.json();

      return {
        statusCode: res.ok ? 200 : res.status,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(res.ok ? { ok: true, path } : data),
      };
    }

    // ── DELETE: remover arquivo ────────────────────────────
    if (event.httpMethod === "DELETE") {
      const { path, sha, message } = JSON.parse(event.body);

      if (!path || !sha) {
        return {
          statusCode: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "path e sha são obrigatórios." }),
        };
      }

      const res  = await fetch(`${BASE}/${path}`, {
        method:  "DELETE",
        headers: GH_HEADERS,
        body:    JSON.stringify({
          message: message || `Delete: ${path}`,
          sha,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          statusCode: res.status,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: errData.message || `HTTP ${res.status}` }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, deleted: path }),
      };
    }

    return {
      statusCode: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Método não permitido." }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
