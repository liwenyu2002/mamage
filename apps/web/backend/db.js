const knex = require('knex');

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = 3306,
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'mamage',
} = process.env;

const db = knex({
  client: 'mysql2',
  connection: {
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    multipleStatements: true,
  },
  pool: { min: 0, max: 7 },
});

module.exports = db;
