# 🧴 Skin Analyser

AI-powered skincare product recommendation and analysis system. Uses Google Gemini to analyze skin images and provides personalized product recommendations based on skin type and concerns.

## 🐳 One-Click Docker Setup (Recommended)

> **Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

### 1. Clone & configure

```bash
git clone https://github.com/nandanakp149/skin-analysis-ai.git
cd skin-analysis-ai
```

Copy `.env.example` to `.env` and add your Google API key:

```bash
copy .env.example .env
# Edit .env and set GOOGLE_API_KEY=your_key_here
```

### 2. Run with one command

```bash
docker compose up --build
```

That's it! Docker will:
- Pull and start **MySQL 8.0** automatically
- Build and start the **Node.js app**
- Run all database migrations and seed 50+ records
- Be ready at **http://localhost:3000**

### 3. Access the app

| URL | Description |
|-----|-------------|
| http://localhost:3000 | Homepage |
| http://localhost:3000/products | Browse Products |
| http://localhost:3000/register | Create Account |
| http://localhost:3000/login | Login |
| http://localhost:3000/admin | Admin Panel |

**Admin credentials:** `admin@skincare.com` / `admin123`

### Stop / Restart

```bash
docker compose down          # Stop containers (data preserved)
docker compose down -v       # Stop + delete all data (fresh start)
docker compose up            # Restart (no rebuild)
```

---

## Features

- **User Registration & Login** — Secure authentication with hashed passwords
- **AI Skin Analysis** — Upload skin photos for instant AI-powered analysis using Google Gemini 1.5 Flash
- **Product Catalogue** — 55+ products across 5 categories with ingredient safety analysis
- **Skin Quiz** — Personalized recommendations based on skin concerns
- **Review System** — Rate and review products with trigger-enforced validations
- **Admin Panel** — Full CRUD management, reports, CSV export, audit logs
- **7 Database Tables** — With views, triggers, joins and aggregate queries
- **Beautiful UI** — Modern glass-card design with Tailwind CSS

## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** HTML, Tailwind CSS (CDN)
- **Database:** MySQL
- **AI:** Google Gemini 1.5 Flash (Vision)
- **Auth:** bcryptjs, express-session

## Prerequisites

- [Node.js](https://nodejs.org/) v16+
- [MySQL](https://dev.mysql.com/downloads/) (running locally or remote)

## Setup

### 1. Clone & Install

```bash
cd skin-analyser
npm install
```

### 2. Configure Environment

Edit the `.env` file with your MySQL credentials:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=skin_analyser
SESSION_SECRET=your-secret-key
GOOGLE_API_KEY=your-google-api-key
```

### 3. Start MySQL

Make sure MySQL is running. The app will **auto-create** the database and tables on first run.

Or manually run the schema:

```bash
mysql -u root -p < database/schema.sql
```

### 4. Run the App

```bash
node app.js
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

## Pages

| Route | Description |
|-------|-------------|
| `/register` | Create a new account |
| `/login` | Sign in to your account |
| `/dashboard` | Main dashboard with quick actions |
| `/analyze` | Upload skin image for AI analysis |
| `/history` | View past analyses |

## Project Structure

```
skin-analyser/
├── app.js                 # Express server entry point
├── config/
│   └── database.js        # MySQL connection & initialization
├── middleware/
│   └── auth.js            # Authentication middleware
├── routes/
│   ├── auth.js            # Login & register routes
│   └── analysis.js        # Skin analysis & history routes
├── public/
│   ├── register.html      # Registration page
│   ├── login.html         # Login page
│   ├── dashboard.html     # Dashboard page
│   ├── analyze.html       # Analysis page
│   ├── history.html       # History page
│   └── 404.html           # 404 page
├── uploads/               # Uploaded skin images
├── database/
│   └── schema.sql         # Database schema
├── .env                   # Environment variables
└── package.json
```

## License

MIT
