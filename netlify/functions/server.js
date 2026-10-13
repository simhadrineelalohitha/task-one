const serverless = require('serverless-http');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const database = require('./database-serverless');
let db;

// Auth middleware
const requireAuth = function(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
};

const app = express();

// Disable x-powered-by header
app.disable('x-powered-by');

// Security middleware
app.use(helmet({ 
  contentSecurityPolicy: { 
    directives: { 
      defaultSrc: ["'self'"], 
      imgSrc: ["'self'", 'https:', 'data:'], 
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], 
      scriptSrc: ["'self'"], 
      connectSrc: ["'self'"] 
    } 
  } 
}));

app.use(express.json({ limit: '20kb' }));

app.use(session({ 
  name: 'shopsphere.sid', 
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-before-deploying-123', 
  resave: false, 
  saveUninitialized: false, 
  cookie: { 
    httpOnly: true, 
    sameSite: 'lax', 
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 
  } 
}));

const emailValid = email => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const cleanText = (value, max = 120) => typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0,max) : '';
const productView = p => ({ id:p.id,name:p.name,category:p.category,description:p.description,price:p.price,image:p.image,rating:p.rating,stock:p.stock });
const orderDetails = id => {
 const order = db.prepare('SELECT id,order_number AS orderNumber,customer_name AS customerName,email,address,city,postal_code AS postalCode,subtotal,total,status,created_at AS createdAt FROM orders WHERE id=?').get(id);
 if (!order) return null;
 order.items = db.prepare('SELECT product_id AS productId,product_name AS name,unit_price AS price,quantity,image FROM order_items WHERE order_id=?').all(id);
 return order;
};

app.get('/api/products', (req,res) => {
 const q = cleanText(req.query.q, 100); const category = cleanText(req.query.category,50);
 const rows = db.prepare(`SELECT * FROM products WHERE (?='' OR name LIKE ? OR description LIKE ? OR category LIKE ?) AND (?='' OR category=?) ORDER BY id`).all(q,`%${q}%`,`%${q}%`,`%${q}%`,category,category);
 res.json(rows.map(productView));
});

app.get('/api/products/:id', (req,res) => {
 const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));
 if (!p) return res.status(404).json({error:'Product not found.'}); res.json(productView(p));
});

app.post('/api/auth/register', async (req,res) => {
 const name=cleanText(req.body?.name,80), email=cleanText(req.body?.email,254).toLowerCase(), password=req.body?.password;
 if (name.length<2 || !emailValid(email) || typeof password!=='string' || password.length<8 || password.length>100) return res.status(400).json({error:'Enter a name, valid email, and password of at least 8 characters.'});
 try { const hash=await bcrypt.hash(password,12); const result=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,hash); req.session.user={id:Number(result.lastInsertRowid),name,email}; res.status(201).json({user:req.session.user}); }
 catch(e) { if(e.code==='SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({error:'An account with that email already exists.'}); throw e; }
});

app.post('/api/auth/login', async (req,res) => {
 const email=cleanText(req.body?.email,254).toLowerCase(), password=req.body?.password;
 if(!emailValid(email)||typeof password!=='string') return res.status(400).json({error:'Enter a valid email and password.'});
 const user=db.prepare('SELECT id,name,email,password_hash FROM users WHERE email=?').get(email);
 if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'Email or password is incorrect.'});
 req.session.regenerate(err=>{ if(err)return res.status(500).json({error:'Could not start your session.'}); req.session.user={id:user.id,name:user.name,email:user.email}; res.json({user:req.session.user}); });
});

app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user||null}));

app.post('/api/auth/logout',(req,res)=>req.session.destroy(err=>{if(err)return res.status(500).json({error:'Could not sign out.'});res.clearCookie('shopsphere.sid');res.json({ok:true});}));

app.get('/api/cart',requireAuth,(req,res)=>{
 const items=db.prepare(`SELECT p.id AS productId,p.name,p.price,p.image,p.stock,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id`).all(req.session.user.id);
 res.json({items:items.map(i=>({...i,lineTotal:Number((i.price*i.quantity).toFixed(2))})),subtotal:Number(items.reduce((s,i)=>s+i.price*i.quantity,0).toFixed(2))});
});

app.post('/api/cart/items',requireAuth,(req,res)=>{
 const productId=Number(req.body?.productId), quantity=Number(req.body?.quantity??1);
 if(!Number.isInteger(productId)||!Number.isInteger(quantity)||quantity<1||quantity>20)return res.status(400).json({error:'Choose a valid product and quantity (1–20).'});
 const p=db.prepare('SELECT stock FROM products WHERE id=?').get(productId); if(!p)return res.status(404).json({error:'Product not found.'});
 const current=db.prepare('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?').get(req.session.user.id,productId)?.quantity||0;
 if(current+quantity>p.stock)return res.status(409).json({error:p.stock===0?'This item is out of stock.':`Only ${p.stock} available.`});
 db.prepare('INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(req.session.user.id,productId,quantity); res.status(201).json({ok:true});
});

app.patch('/api/cart/items/:id',requireAuth,(req,res)=>{
 const id=Number(req.params.id), quantity=Number(req.body?.quantity); if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1||quantity>20)return res.status(400).json({error:'Choose a valid quantity (1–20).'});
 const p=db.prepare('SELECT stock FROM products WHERE id=?').get(id); if(!p)return res.status(404).json({error:'Product not found.'}); if(quantity>p.stock)return res.status(409).json({error:`Only ${p.stock} available.`});
 const result=db.prepare('UPDATE cart_items SET quantity=? WHERE user_id=? AND product_id=?').run(quantity,req.session.user.id,id); if(!result.changes)return res.status(404).json({error:'Cart item not found.'});res.json({ok:true});
});

app.delete('/api/cart/items/:id',requireAuth,(req,res)=>{const r=db.prepare('DELETE FROM cart_items WHERE user_id=? AND product_id=?').run(req.session.user.id,Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Cart item not found.'});res.json({ok:true});});

app.post('/api/orders',requireAuth,(req,res)=>{
 const customerName=cleanText(req.body?.customerName,80), email=cleanText(req.body?.email,254).toLowerCase(), address=cleanText(req.body?.address,180), city=cleanText(req.body?.city,80), postalCode=cleanText(req.body?.postalCode,16);
 if(customerName.length<2||!emailValid(email)||address.length<5||city.length<2||postalCode.length<3)return res.status(400).json({error:'Please complete all shipping fields with valid details.'});
 const items=db.prepare('SELECT c.product_id AS productId,c.quantity,p.name,p.price,p.image,p.stock FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=?').all(req.session.user.id);
 if(!items.length)return res.status(400).json({error:'Your cart is empty.'});
 try {
  const create=db.transaction(()=>{
   for(const item of items){if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)throw new Error('Invalid quantity in cart.');if(item.stock<item.quantity)throw new Error(`${item.name} has only ${item.stock} left. Please update your cart.`);}
   const subtotal=Number(items.reduce((sum,item)=>sum+item.price*item.quantity,0).toFixed(2));
   const orderNumber=`SS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
   const result=db.prepare('INSERT INTO orders(order_number,user_id,customer_name,email,address,city,postal_code,subtotal,total) VALUES(?,?,?,?,?,?,?,?,?)').run(orderNumber,req.session.user.id,customerName,email,address,city,postalCode,subtotal,subtotal);
   const add=db.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,image) VALUES(?,?,?,?,?,?)');
   const stock=db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?');
   for(const item of items){const changed=stock.run(item.quantity,item.productId,item.quantity);if(!changed.changes)throw new Error(`${item.name} just sold out. Please update your cart.`);add.run(result.lastInsertRowid,item.productId,item.name,item.price,item.quantity,item.image);}
   db.prepare('DELETE FROM cart_items WHERE user_id=?').run(req.session.user.id);return Number(result.lastInsertRowid);
  });
  const id=create();res.status(201).json({order:orderDetails(id)});
 }catch(e){if(/left|sold out|quantity/.test(e.message))return res.status(409).json({error:e.message});throw e;}
});

app.get('/api/orders',requireAuth,(req,res)=>{
 const orders=db.prepare('SELECT id,order_number AS orderNumber,total,status,created_at AS createdAt FROM orders WHERE user_id=? ORDER BY id DESC').all(req.session.user.id);res.json(orders);
});

app.get('/api/orders/:id',requireAuth,(req,res)=>{const o=orderDetails(Number(req.params.id));if(!o)return res.status(404).json({error:'Order not found.'});if(db.prepare('SELECT 1 FROM orders WHERE id=? AND user_id=?').get(o.id,req.session.user.id)===undefined)return res.status(404).json({error:'Order not found.'});res.json({order:o});});

app.use('/api',(err,req,res,next)=>{console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'});});

// Initialize database
let handler;
database.ready().then(readyDb => {
  db = readyDb;
  handler = serverless(app);
}).catch(err => {
  console.error('Database initialization failed:', err);
});

exports.handler = async (event, context) => {
  if (!handler) {
    await database.ready().then(readyDb => {
      db = readyDb;
      handler = serverless(app);
    });
  }
  return handler(event, context);
};
