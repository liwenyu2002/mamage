const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const db = require('./db');
const usersRouter = require('./routes/users');

const {
  PORT = 3000,
  DEV_FRONTEND_ORIGIN = 'http://localhost:5173'
} = process.env;

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({ origin: DEV_FRONTEND_ORIGIN, credentials: true }));

// Ensure users table exists (simple auto-migration)
async function ensureTables() {
  const exists = await db.schema.hasTable('users');
  if (!exists) {
    await db.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('student_no').nullable().unique();
      table.string('name').notNullable();
      table.string('password_hash').notNullable();
      table.string('email').nullable().unique();
      table.string('department').nullable();
      table.string('role').notNullable().defaultTo('user');
      table.string('avatar_url').nullable();
      table.string('nickname').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
    console.log('Created users table');
  }
}

app.use('/api/users', usersRouter);

app.get('/ping', (req, res) => res.send('pong'));

ensureTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend example listening on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to ensure tables', err);
  process.exit(1);
});
