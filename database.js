const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const file = process.env.DATABASE_FILE || './data/shopsphere.db';
const dbPath = path.resolve(file);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
let db;
let inTransaction = false;
function persist() { if (!inTransaction) fs.writeFileSync(dbPath, Buffer.from(db.export())); }
let rawPrepare;
function prepare(sql) {
 return {
  all(...params) { const s=rawPrepare(sql); try { s.bind(params); const rows=[]; while(s.step()) rows.push(s.getAsObject()); return rows; } finally { s.free(); } },
  get(...params) { const s=rawPrepare(sql); try { s.bind(params); return s.step()?s.getAsObject():undefined; } finally { s.free(); } },
  run(...params) { try { db.run(sql,params); } catch(e) { if(/UNIQUE constraint failed/i.test(e.message)) e.code='SQLITE_CONSTRAINT_UNIQUE'; throw e; } const result=db.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid'); const meta=result[0]?.values[0]||[0,0]; persist(); return {changes:Number(meta[0]),lastInsertRowid:Number(meta[1])}; }
 };
}
const databaseReady = initSqlJs().then(SQL => {
 db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
 db.run('PRAGMA foreign_keys = ON');
 db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
 description TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), image TEXT NOT NULL,
 rating REAL NOT NULL DEFAULT 4.5, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0)
);
CREATE TABLE IF NOT EXISTS cart_items (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE,
 user_id INTEGER NOT NULL REFERENCES users(id), customer_name TEXT NOT NULL,
 email TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, postal_code TEXT NOT NULL,
 subtotal REAL NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
 unit_price REAL NOT NULL, quantity INTEGER NOT NULL, image TEXT NOT NULL
);
`);

const products = [
 ['Nova Wireless Headphones','Electronics','Immersive sound, soft memory-foam cushions, and 30 hours of battery life make every playlist feel personal.',89.99,'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85',4.8,18],
 ['Arc Minimal Watch','Accessories','A clean stainless-steel timepiece with a scratch-resistant face and a comfortable everyday strap.',119,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85',4.7,12],
 ['Everyday Canvas Tote','Fashion','Roomy recycled cotton canvas with reinforced handles. Made for market mornings and everyday errands.',32,'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85',4.6,25],
 ['Ribbed Ceramic Vase','Home','A sculptural, hand-finished ceramic vase that brings a quiet touch of texture to any shelf or table.',46,'https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85',4.9,9],
 ['The Art of Slow Living','Books','A thoughtful guide to making more room for rituals, creativity, and the little things that make a home.',24.5,'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=85',4.8,31],
 ['Studio Over-Ear Headphones','Electronics','Balanced studio-inspired audio in a lightweight, foldable design with a detachable cable.',149.5,'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=85',4.7,7],
 ['Linen Throw Blanket','Home','Relaxed European linen with a naturally soft feel. A breathable layer for slow evenings and cool mornings.',78,'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85',4.5,14],
 ['Classic Leather Sneakers','Fashion','An understated low-top sneaker in responsibly sourced leather, with a cushioned footbed for all-day wear.',95,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85',4.6,16],
 ['Everyday Water Bottle','Accessories','Double-wall insulated stainless steel keeps drinks cold for 24 hours or hot for 12. Holds 600 ml.',28,'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=85',4.4,0],
 ['Field Notes Journal Set','Books','Three pocket-sized notebooks with smooth, uncoated pages for lists, sketches, and ideas on the go.',18,'https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=900&q=85',4.7,20]
];
// Remove repeated seed rows left by interrupted or simultaneous first starts.
db.run(`DELETE FROM products WHERE id NOT IN (SELECT MIN(id) FROM products GROUP BY name, category)
 AND id NOT IN (SELECT product_id FROM cart_items) AND id NOT IN (SELECT product_id FROM order_items)`);
db.run('BEGIN');
try {
 products.forEach(p => db.run(`INSERT INTO products(name,category,description,price,image,rating,stock)
  SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM products WHERE name=? AND category=?)`, [...p,p[0],p[1]]));
 db.run('COMMIT');
} catch(e) { db.run('ROLLBACK'); throw e; }
persist();
 rawPrepare=db.prepare.bind(db); db.prepare = prepare;
db.transaction = fn => (...args) => { db.run('BEGIN IMMEDIATE'); inTransaction=true; try { const result=fn(...args); db.run('COMMIT'); inTransaction=false; persist(); return result; } catch(e) { db.run('ROLLBACK'); inTransaction=false; throw e; } };
db.pragma = () => {};
return db;
});

module.exports = { ready: () => databaseReady, get: () => db };
