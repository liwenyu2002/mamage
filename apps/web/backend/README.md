Backend example for MaMage (Express + MySQL)

Quick start (development):

1. Set environment variables (example):

On Windows (PowerShell):

```powershell
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='3306'
$env:DB_USER='root'
$env:DB_PASSWORD='your_mysql_password'
$env:DB_NAME='mamage'
$env:JWT_SECRET='please-change-this-to-a-random-secret'
$env:PORT='3000'
```

2. Install dependencies:

```powershell
cd backend
npm install
```

3. Start server:

```powershell
npm run dev  # requires nodemon, or use npm start
```

Server will auto-create `users` table if not present. Routes:

- POST `/api/users/register`  { name, password, email?, student_no? } -> { id, token }
- POST `/api/users/login`     { email | student_no, password } -> { id, token }
- GET  `/api/users/me`        Authorization: Bearer <token> -> user object
- PUT  `/api/users/me`        Authorization: Bearer <token>, body with updatable fields

Note: This is an example implementation for local development. For production use:
- run proper migrations instead of auto-creating tables on startup
- use strong `JWT_SECRET`, HTTPS and proper cookie settings
- consider using refresh tokens, rate-limiting, and audit on login attempts
