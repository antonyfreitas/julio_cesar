// ═══════════════════════════════════════════════════════════
// Proxy seguro para a GitHub API.
// O GITHUB_TOKEN fica como variável de ambiente no Netlify —
// nunca exposto no código ou repositório público.
// ═══════════════════════════════════════════════════════════

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO; // ex: "antonyfreitas/julio_cesar"
const BASE         = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

const GH_HEADERS = {
  Authorization:          `Bearer ${GITHUB_TOKEN}`,
  Accept:                 "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type":         "application/json",
};

exports.handler = async (event) => {
  // Pre-flight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Variáveis de ambiente não configuradas." }),
    };
  }

  try {
    // ── GET: listar arquivos de uma pasta ──────────────────
    if (event.httpMethod === "GET") {
      const path = event.queryStringParameters?.path || "";
      const res  = await fetch(`${BASE}/${path}`, { headers: GH_HEADERS });

      // Pasta ainda não existe → retorna vazio sem erro
      if (res.status === 404) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify([]) };
      }

      const data = await res.json();
      const files = Array.isArray(data)
        ? data.filter((f) => f.type === "file")
        : [];

      return { statusCode: 200, headers: CORS, body: JSON.stringify(files) };
    }

    // ── POST: fazer upload de arquivo ─────────────────────
    if (event.httpMethod === "POST") {
      const { path, content, message } = JSON.parse(event.body);

      if (!path || !content) {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ error: "path e content são obrigatórios." }),
        };
      }

      // Verifica se o arquivo já existe (precisa do SHA para sobrescrever)
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
        headers:    CORS,
        body:       JSON.stringify(data),
      };
    }

    // ── DELETE: remover arquivo ────────────────────────────
    if (event.httpMethod === "DELETE") {
      const { path, sha, message } = JSON.parse(event.body);

      if (!path || !sha) {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ error: "path e sha são obrigatórios." }),
        };
      }

      const res  = await fetch(`${BASE}/${path}`, {
        method:  "DELETE",
        headers: GH_HEADERS,
        body:    JSON.stringify({ message: message || `Delete: ${path}`, sha }),
      });
      const data = await res.json();

      return {
        statusCode: res.ok ? 200 : res.status,
        headers:    CORS,
        body:       JSON.stringify(data),
      };
    }

    return {
      statusCode: 405,
      headers:    CORS,
      body:       JSON.stringify({ error: "Método não permitido." }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers:    CORS,
      body:       JSON.stringify({ error: err.message }),
    };
  }
};
