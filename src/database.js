const path = require("path");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "..", "solaria.db"));
db.pragma("journal_mode = WAL");

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

CREATE TABLE IF NOT EXISTS catalog (
  item TEXT PRIMARY KEY,
  unit_qty INTEGER NOT NULL,
  unit_price REAL NOT NULL
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
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
`);

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
function upsertCatalogItem(item, unitQty, unitPrice) {
  db.prepare(
    "INSERT INTO catalog (item, unit_qty, unit_price) VALUES (?, ?, ?) ON CONFLICT(item) DO UPDATE SET unit_qty = excluded.unit_qty, unit_price = excluded.unit_price"
  ).run(item.toLowerCase(), unitQty, unitPrice);
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
  return db.prepare("SELECT * FROM catalog ORDER BY item ASC").all();
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
  return info.lastInsertRowid;
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
function createTicket(channelId, discordId, orderId) {
  db.prepare(
    "INSERT INTO tickets (channel_id, discord_id, order_id, status, created_at) VALUES (?, ?, ?, 'open', ?)"
  ).run(channelId, discordId, orderId ?? null, Date.now());
}
function closeTicket(channelId) {
  db.prepare("UPDATE tickets SET status = 'closed' WHERE channel_id = ?").run(channelId);
}
function getTicket(channelId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
}
function getOpenTicketByUser(discordId) {
  return db
    .prepare("SELECT * FROM tickets WHERE discord_id = ? AND status = 'open'")
    .get(discordId);
}

module.exports = {
  db,
  setSetting,
  getSetting,
  linkAccount,
  unlinkAccount,
  getLink,
  getLinkByIgn,
  upsertCatalogItem,
  removeCatalogItem,
  getCatalogItem,
  listCatalog,
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
};
