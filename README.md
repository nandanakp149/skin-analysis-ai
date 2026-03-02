# 🧴 Skin Analyser

AI-powered skin analysis application that uses Google Gemini to analyze skin images and provide personalized skincare recommendations with product suggestions.

## Features

- **User Registration & Login** — Secure authentication with hashed passwords
- **AI Skin Analysis** — Upload skin photos for instant AI-powered analysis using Google Gemini 1.5 Flash
- **Personalized Recommendations** — Get skincare routines tailored to your age and gender
- **Product Suggestions** — Receive product recommendations with direct shopping links
- **Analysis History** — Track your skin health over time
- **Beautiful UI** — Modern, aesthetic design with Tailwind CSS

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
