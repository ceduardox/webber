const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.ndjson");
const EVENTS_FILE = path.join(DATA_DIR, "events.ndjson");
const DB_FILE = path.join(DATA_DIR, "funnel.sqlite");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
let dbStatements = null;

function initSqlite() {
  try {
    // Node 24+ builtin SQLite (no external dependencies).
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(DB_FILE);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        city TEXT NOT NULL,
        discount INTEGER NOT NULL,
        final_price INTEGER NOT NULL,
        knowledge_score INTEGER NOT NULL DEFAULT 0,
        quiz_answers_json TEXT NOT NULL DEFAULT '[]',
        channel TEXT NOT NULL DEFAULT 'web',
        source_page TEXT NOT NULL DEFAULT '/',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL,
        event_data_json TEXT NOT NULL,
        page TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON analytics_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(event_name);
    `);

    const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((col) => String(col.name));
    if (!orderColumns.includes("knowledge_score")) {
      db.exec("ALTER TABLE orders ADD COLUMN knowledge_score INTEGER NOT NULL DEFAULT 0");
    }
    if (!orderColumns.includes("quiz_answers_json")) {
      db.exec("ALTER TABLE orders ADD COLUMN quiz_answers_json TEXT NOT NULL DEFAULT '[]'");
    }

    dbStatements = {
      insertOrder: db.prepare(`
        INSERT INTO orders (
          order_id, name, phone, city, discount, final_price, knowledge_score, quiz_answers_json, channel, source_page, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertEvent: db.prepare(`
        INSERT INTO analytics_events (
          event_name, event_data_json, page, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `),
    };
    console.log(`SQLite ready at ${DB_FILE}`);
  } catch (error) {
    console.warn("SQLite disabled. Falling back to NDJSON only.", error.message);
  }
}

initSqlite();

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function appendNdjson(filePath, payload) {
  fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, (err) => {
    if (err) {
      console.error(`Failed writing ${path.basename(filePath)}:`, err.message);
    }
  });
}

function persistOrder(order) {
  appendNdjson(ORDERS_FILE, order);

  if (!db || !dbStatements) return;
  try {
    dbStatements.insertOrder.run(
      order.order_id,
      order.name,
      order.phone,
      order.city,
      order.discount,
      order.final_price,
      order.knowledge_score || 0,
      JSON.stringify(order.quiz_answers || []),
      order.channel || "web",
      order.source_page || "/",
      order.user_agent || "",
      order.timestamp
    );
  } catch (error) {
    console.error("Failed writing order to SQLite:", error.message);
  }
}

function persistEvent(eventRecord) {
  appendNdjson(EVENTS_FILE, eventRecord);

  if (!db || !dbStatements) return;
  try {
    dbStatements.insertEvent.run(
      eventRecord.event_name,
      JSON.stringify(eventRecord.event_data || {}),
      eventRecord.page || "/",
      eventRecord.user_agent || "",
      eventRecord.timestamp
    );
  } catch (error) {
    console.error("Failed writing analytics event to SQLite:", error.message);
  }
}

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", (error) => reject(error));
  });
}

function serveStaticFile(res, requestedPath) {
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const isRootPath = safePath === "/" || safePath === "\\";
  const finalPath = isRootPath ? "index.html" : safePath.replace(/^[/\\]/, "");
  const absolutePath = path.join(PUBLIC_DIR, finalPath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(absolutePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const cacheControl = ext === ".html" ? "no-store" : "public, max-age=604800, immutable";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": cacheControl,
    });

    fs.createReadStream(absolutePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  if (req.method === "POST" && pathname === "/api/order") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");

      const name = String(payload.name || "").trim();
      const phone = String(payload.phone || "").trim();
      const city = String(payload.city || "").trim();
      const discount = Number(payload.discount || 0);
      const finalPrice = Number(payload.final_price || 0);
      const knowledgeScore = Number(payload.knowledge_score || 0);
      const quizAnswers = Array.isArray(payload.quiz_answers) ? payload.quiz_answers : [];
      const channel = String(payload.channel || "web").trim();
      const sourcePage = String(payload.source_page || "/").trim();
      const timestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();

      if (!name || !phone || !city) {
        sendJson(res, 400, { ok: false, error: "Missing required fields" });
        return;
      }

      const orderId = `BOL-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

      const order = {
        order_id: orderId,
        name,
        phone,
        city,
        discount: Number.isFinite(discount) ? Math.max(0, Math.round(discount)) : 0,
        final_price: Number.isFinite(finalPrice) ? Math.max(0, Math.round(finalPrice)) : 0,
        knowledge_score: Number.isFinite(knowledgeScore) ? Math.max(0, Math.min(100, Math.round(knowledgeScore))) : 0,
        quiz_answers: quizAnswers.slice(0, 10),
        channel: channel || "web",
        source_page: sourcePage || "/",
        user_agent: req.headers["user-agent"] || "",
        timestamp,
      };

      persistOrder(order);
      sendJson(res, 200, { ok: true, order_id: orderId });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "Invalid JSON payload" });
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/analytics") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const eventName = String(payload.event_name || "").trim();

      if (!eventName) {
        sendJson(res, 400, { ok: false, error: "event_name is required" });
        return;
      }

      const eventRecord = {
        event_name: eventName,
        event_data: payload.event_data || {},
        page: payload.page || "/",
        user_agent: req.headers["user-agent"] || "",
        timestamp: new Date().toISOString(),
      };

      persistEvent(eventRecord);
      sendJson(res, 200, { ok: true });
      return;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "Invalid JSON payload" });
      return;
    }
  }

  if (req.method === "GET") {
    serveStaticFile(res, pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Berberina funnel ready at http://localhost:${PORT}`);
});
