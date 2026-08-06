const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'db.json');
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// Ensure upload folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initialDb = { keys: [], screenshots: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2), 'utf-8');
    return initialDb;
  }
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading database file, resetting:", err);
    return { keys: [], screenshots: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  DB_PATH,
  UPLOADS_DIR,
  readDb,
  writeDb
};
