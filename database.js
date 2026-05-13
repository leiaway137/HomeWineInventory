const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, 'inventory.db');
let db = null;

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  let fileBuffer = null;
  if (fs.existsSync(dbPath)) {
    fileBuffer = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(fileBuffer);
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      storage_type TEXT,
      temperature_controlled BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bottles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      type TEXT,
      varietal TEXT,
      region TEXT,
      country TEXT,
      vintage INTEGER,
      volume_ml INTEGER DEFAULT 750,
      quantity INTEGER DEFAULT 1,
      price_paid REAL,
      market_price REAL,
      market_price_data TEXT,
      last_price_search DATETIME,
      location_id INTEGER,
      front_label_path TEXT,
      back_label_path TEXT,
      summary TEXT,
      background TEXT,
      flavor_profile TEXT,
      food_pairings TEXT,
      ideal_drink_by TEXT,
      storage_instructions TEXT,
      recommended_temp TEXT,
      storage_position TEXT,
      needs_cooler BOOLEAN DEFAULT 0,
      ai_analyzed BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS consumption_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bottle_id INTEGER,
      quantity_consumed INTEGER DEFAULT 1,
      occasion TEXT,
      notes TEXT,
      consumed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bottle_id) REFERENCES bottles(id) ON DELETE SET NULL
    )
  `);

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_bottles_type ON bottles(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bottles_location ON bottles(location_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bottles_vintage ON bottles(vintage)');
  
  return db;
}

// Save database to file
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Close database
function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
  }
}

module.exports = { initDatabase, db: () => db, saveDatabase, closeDatabase };