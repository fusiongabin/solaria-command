const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "..", "solaria.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS links (
  discord_id TEXT PRIMARY KEY,
  ign TEXT NOT NULL,
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_categories (
  name TEXT PRIMARY KEY,
  emoji TEXT NOT NULL DEFAULT '📁',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog (
  item TEXT PRIMARY KEY,
  unit_qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📦',
  category TEXT NOT NULL DEFAULT 'Général'
);

CREATE TABLE IF NOT EXISTS blacklist (
  discord_id TEXT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  added_at INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  ign TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  total_price REAL,
  status TEXT NOT NULL,          -- unlisted_review, pending_review, declined, in_progress, ready, completed
  is_custom INTEGER NOT NULL DEFAULT 0,
  admin_channel_id TEXT,
  admin_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  order_id INTEGER,
  type TEXT NOT NULL DEFAULT 'recuperation', -- recuperation, signalement, autre
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  text TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open, validated, rejected
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id INTEGER NOT NULL,
  discord_id TEXT NOT NULL,
  vote INTEGER NOT NULL, -- 1 = pour, -1 = contre
  PRIMARY KEY (suggestion_id, discord_id)
);
`);

// Migration : ajoute la colonne 'type' si la table 'tickets' existait déjà sans elle (anciennes installs)
try {
  const cols = db.prepare("PRAGMA table_info(tickets)").all();
  if (!cols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE tickets ADD COLUMN type TEXT NOT NULL DEFAULT 'recuperation'");
  }
} catch {
  // ignore
}

// Migration : ajoute la colonne 'emoji' si la table 'catalog' existait déjà sans elle (anciennes installs)
try {
  const catalogCols = db.prepare("PRAGMA table_info(catalog)").all();
  if (!catalogCols.some((c) => c.name === "emoji")) {
    db.exec("ALTER TABLE catalog ADD COLUMN emoji TEXT NOT NULL DEFAULT '📦'");
  }
  if (!catalogCols.some((c) => c.name === "category")) {
    db.exec("ALTER TABLE catalog ADD COLUMN category TEXT NOT NULL DEFAULT 'Général'");
  }
} catch {
  // ignore
}

// ---------- settings (key/value store for generated IDs, rules message id, etc.) ----------
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function listSettingsByPrefix(prefix) {
  return db.prepare("SELECT * FROM settings WHERE key LIKE ?").all(`${prefix}%`);
}
function deleteSettingsByPrefix(prefix) {
  db.prepare("DELETE FROM settings WHERE key LIKE ?").run(`${prefix}%`);
}

// ---------- links ----------
function linkAccount(discordId, ign) {
  db.prepare(
    "INSERT INTO links (discord_id, ign, linked_at) VALUES (?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET ign = excluded.ign, linked_at = excluded.linked_at"
  ).run(discordId, ign, Date.now());
}
function unlinkAccount(discordId) {
  db.prepare("DELETE FROM links WHERE discord_id = ?").run(discordId);
}
function getLink(discordId) {
  return db.prepare("SELECT * FROM links WHERE discord_id = ?").get(discordId);
}
function getLinkByIgn(ign) {
  return db
    .prepare("SELECT * FROM links WHERE LOWER(ign) = LOWER(?)")
    .get(ign);
}

// ---------- catalog ----------
function upsertCatalogItem(item, unitQty, unitPrice, emoji = "📦", category = "Général") {
  const cat = (category || "Général").trim() || "Général";
  ensureCategory(cat);
  db.prepare(
    "INSERT INTO catalog (item, unit_qty, unit_price, emoji, category) VALUES (?, ?, ?, ?, ?) ON CONFLICT(item) DO UPDATE SET unit_qty = excluded.unit_qty, unit_price = excluded.unit_price, emoji = excluded.emoji, category = excluded.category"
  ).run(item.toLowerCase(), unitQty, unitPrice, emoji || "📦", cat);
}
function removeCatalogItem(item) {
  db.prepare("DELETE FROM catalog WHERE item = ?").run(item.toLowerCase());
}
function getCatalogItem(item) {
  return db
    .prepare("SELECT * FROM catalog WHERE item = ?")
    .get(item.toLowerCase());
}
function listCatalog() {
  return db.prepare("SELECT * FROM catalog ORDER BY category ASC, item ASC").all();
}
function listCatalogByCategory(category) {
  return db.prepare("SELECT * FROM catalog WHERE category = ? ORDER BY item ASC").all(category);
}
function listDistinctCatalogCategories() {
  return db
    .prepare("SELECT DISTINCT category FROM catalog ORDER BY category ASC")
    .all()
    .map((r) => r.category);
}

// ---------- catalog categories ----------
function ensureCategory(name, emoji = "📁") {
  db.prepare(
    "INSERT INTO catalog_categories (name, emoji, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING"
  ).run(name, emoji, Date.now());
}
function createCategory(name, emoji = "📁") {
  db.prepare(
    "INSERT INTO catalog_categories (name, emoji, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET emoji = excluded.emoji"
  ).run(name, emoji || "📁", Date.now());
}
function removeCategory(name) {
  db.prepare("DELETE FROM catalog_categories WHERE name = ?").run(name);
  // Les items existants dans cette catégorie repassent dans 'Général' plutôt que d'être orphelins
  db.prepare("UPDATE catalog SET category = 'Général' WHERE category = ?").run(name);
}
function listCategories() {
  return db.prepare("SELECT * FROM catalog_categories ORDER BY name ASC").all();
}
function getCategoryEmoji(name) {
  const row = db.prepare("SELECT emoji FROM catalog_categories WHERE name = ?").get(name);
  return row?.emoji || "📁";
}

// ---------- blacklist ----------
function addBlacklist(discordId, reason, addedBy) {
  db.prepare(
    "INSERT INTO blacklist (discord_id, reason, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by, added_at = excluded.added_at"
  ).run(discordId, reason || "Non précisée", addedBy, Date.now());
}
function removeBlacklist(discordId) {
  db.prepare("DELETE FROM blacklist WHERE discord_id = ?").run(discordId);
}
function isBlacklisted(discordId) {
  return !!db
    .prepare("SELECT 1 FROM blacklist WHERE discord_id = ?")
    .get(discordId);
}
function listBlacklist() {
  return db.prepare("SELECT * FROM blacklist ORDER BY added_at DESC").all();
}

// ---------- orders ----------
function createOrder({ discordId, ign, item, quantity, totalPrice, status, isCustom }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO orders (discord_id, ign, item, quantity, total_price, status, is_custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(discordId, ign, item, quantity, totalPrice ?? null, status, isCustom ? 1 : 0, now, now);
  return Number(info.lastInsertRowid);
}
function getOrder(id) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
}
function updateOrder(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE orders SET ${setClause}, updated_at = ? WHERE id = ?`).run(
    ...values,
    Date.now(),
    id
  );
}
function getOrdersByUser(discordId) {
  return db
    .prepare("SELECT * FROM orders WHERE discord_id = ? ORDER BY created_at DESC LIMIT 15")
    .all(discordId);
}

// ---------- tickets ----------
function createTicket(channelId, discordId, orderId, type = "recuperation") {
  db.prepare(
    "INSERT INTO tickets (channel_id, discord_id, order_id, type, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)"
  ).run(channelId, discordId, orderId ?? null, type, Date.now());
}
function closeTicket(channelId) {
  db.prepare("UPDATE tickets SET status = 'closed' WHERE channel_id = ?").run(channelId);
}
function getTicket(channelId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
}
function getOpenTicketByUser(discordId, type = null) {
  if (type) {
    return db
      .prepare("SELECT * FROM tickets WHERE discord_id = ? AND status = 'open' AND type = ?")
      .get(discordId, type);
  }
  return db
    .prepare("SELECT * FROM tickets WHERE discord_id = ? AND status = 'open'")
    .get(discordId);
}
function getAllOpenTickets() {
  return db.prepare("SELECT * FROM tickets WHERE status = 'open'").all();
}

// ---------- suggestions ----------
function createSuggestion(discordId, text) {
  const now = Date.now();
  const info = db
    .prepare("INSERT INTO suggestions (discord_id, text, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)")
    .run(discordId, text, now, now);
  return Number(info.lastInsertRowid);
}
function getSuggestion(id) {
  return db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id);
}
function updateSuggestion(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE suggestions SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id);
}
function setSuggestionVote(suggestionId, discordId, vote) {
  db.prepare(
    "INSERT INTO suggestion_votes (suggestion_id, discord_id, vote) VALUES (?, ?, ?) ON CONFLICT(suggestion_id, discord_id) DO UPDATE SET vote = excluded.vote"
  ).run(suggestionId, discordId, vote);
}
function getSuggestionVoteCounts(suggestionId) {
  const up = db
    .prepare("SELECT COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ? AND vote = 1")
    .get(suggestionId).n;
  const down = db
    .prepare("SELECT COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ? AND vote = -1")
    .get(suggestionId).n;
  return { up, down };
}

module.exports = {
  db,
  setSetting,
  getSetting,
  listSettingsByPrefix,
  deleteSettingsByPrefix,
  linkAccount,
  unlinkAccount,
  getLink,
  getLinkByIgn,
  upsertCatalogItem,
  removeCatalogItem,
  getCatalogItem,
  listCatalog,
  listCatalogByCategory,
  listDistinctCatalogCategories,
  createCategory,
  removeCategory,
  listCategories,
  getCategoryEmoji,
  addBlacklist,
  removeBlacklist,
  isBlacklisted,
  listBlacklist,
  createOrder,
  getOrder,
  updateOrder,
  getOrdersByUser,
  createTicket,
  closeTicket,
  getTicket,
  getOpenTicketByUser,
  getAllOpenTickets,
  createSuggestion,
  getSuggestion,
  updateSuggestion,
  setSuggestionVote,
  getSuggestionVoteCounts,
};
