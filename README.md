# ShopSphere

ShopSphere is a small, full-stack demo store built with vanilla HTML/CSS/JavaScript, Express, and SQLite. It includes a responsive catalog, category filters and search, product pages, account registration and login, a database-backed private shopping bag, demo checkout, order confirmation, and customer order history. Checkout collects shipping details but never collects payment information.

## Technologies

- Node.js 18 or newer and Express
- SQLite through `sql.js` (SQLite compiled to WebAssembly; no native compiler needed)
- `express-session` for signed, HTTP-only session cookies
- `bcryptjs` for password hashing
- Plain HTML5, CSS3, and browser JavaScript

## Run locally

1. Install Node.js 18+.
2. In this directory, install dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env`. Set `SESSION_SECRET` to a long, random value. The defaults run locally; `DATABASE_FILE` defaults to `./data/shopsphere.db`.
4. Start the app:

   ```sh
   npm start
   ```

   For development with automatic restart, use `npm run dev`.

The database directory, tables, and ten sample products are created automatically on first start. Open [http://localhost:3000](http://localhost:3000). Set `PORT` to change the port.

## Screenshots

To capture screenshots for an internship submission, start the app and open `http://localhost:3000` in a desktop browser. Capture the storefront, a product detail page, the bag, and the order confirmation after completing the demo workflow. Capture a second storefront view at a mobile viewport to show the responsive layout. Save only presentation screenshots in a `screenshots/` folder; do not include `.env`, database files, or real customer information.

## API overview

All endpoints use JSON. Authentication is maintained using the `shopsphere.sid` session cookie.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/products?q=&category=` | List, search, and filter products |
| GET | `/api/products/:id` | Get product details |
| POST | `/api/auth/register` | Register and sign in |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Get the current session user |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/cart` | Get the signed-in user's bag |
| POST | `/api/cart/items` | Add a product (`productId`, optional `quantity`) |
| PATCH | `/api/cart/items/:id` | Set an item quantity (`quantity`) |
| DELETE | `/api/cart/items/:id` | Remove a bag item |
| POST | `/api/orders` | Validate shipping, create an order, decrement stock, and clear the bag atomically |
| GET | `/api/orders` | List the signed-in user's orders |
| GET | `/api/orders/:id` | Get one of the signed-in user's orders |

## Try the main workflow

1. Browse categories, search for a product, and open its detail page.
2. Register with a name, email, and password of at least eight characters.
3. Add items to the bag, adjust quantities, and remove an item.
4. Continue to checkout, enter shipping details, and place the demo order.
5. Note the order number, open **Your orders**, and view the order details. The bag is cleared and stock is reduced only after the database transaction succeeds.
6. To check stock validation, add more units than the available stock through the API or bag controls and confirm the request is rejected.

The sample catalog uses remote Unsplash images with a fallback image. An internet connection is needed to load those images and the optional Google Fonts; the app and product information are served locally.

## Deployment notes

Deploy to a Node.js host that supports persistent disk storage. Set `NODE_ENV=production`, `SESSION_SECRET` to a private random value, and `DATABASE_FILE` to a persistent writable path. Run `npm install --omit=dev` and `npm start`. Terminate HTTPS at the host or proxy so secure session cookies work. The default in-memory Express session store is intended for a student demo and single-process local use; use a persistent session store and configure SQLite backups before deploying for multiple workers or real customers. This is a demo checkout and is not a payment system.
