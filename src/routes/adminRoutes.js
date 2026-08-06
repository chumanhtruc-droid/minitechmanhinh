const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { readDb, writeDb, UPLOADS_DIR } = require('../config/db');
const { requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Protected admin panel (main index.html)
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

// Admin: Generate a new key
router.post('/api/generate-key', (req, res) => {
  const db = readDb();
  const rawKey = uuidv4().substring(0, 13).toUpperCase().replace('-', '');
  const newKey = `MINITECH-${rawKey.substring(0, 4)}-${rawKey.substring(4, 8)}-${rawKey.substring(8, 12)}`;
  const durationHours = parseInt(req.body.duration_hours, 10) || 0; // 0 = unlimited

  const keyObj = {
    key: newKey,
    createdAt: new Date().toISOString(),
    status: 'active',
    durationHours,          // how many hours from first activation
    activatedAt: null,      // set on first verify-key call
    expiresAt: null         // computed on first verify-key call
  };

  db.keys.push(keyObj);
  writeDb(db);

  res.json({ success: true, key: newKey, durationHours });
});

// Admin & Support: Get all active keys + any keys with uploaded screenshots
router.get('/api/keys', (req, res) => {
  const db = readDb();
  const keyMap = new Map();

  // 1. Add all keys from db.keys
  (db.keys || []).forEach(k => {
    const normKey = (k.key || '').toUpperCase();
    if (normKey) {
      keyMap.set(normKey, {
        ...k,
        key: normKey,
        screenshotCount: 0
      });
    }
  });

  // 2. Add keys from db.screenshots if missing, and update count with case-insensitive matching
  (db.screenshots || []).forEach(s => {
    const normKey = (s.key || '').toUpperCase();
    if (!normKey) return;
    if (!keyMap.has(normKey)) {
      keyMap.set(normKey, {
        key: normKey,
        createdAt: s.createdAt || new Date().toISOString(),
        status: 'active',
        durationHours: 0,
        screenshotCount: 0
      });
    }
    const item = keyMap.get(normKey);
    item.screenshotCount = (item.screenshotCount || 0) + 1;
  });

  res.json({ success: true, keys: Array.from(keyMap.values()) });
});

// Admin: Delete a key
router.post('/api/delete-key', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: "Key parameter missing" });
  }
  
  const db = readDb();
  db.keys = db.keys.filter(k => k.key !== key);
  const screenshotsToDelete = db.screenshots.filter(s => s.key === key);
  db.screenshots = db.screenshots.filter(s => s.key !== key);
  
  // Delete physical files
  screenshotsToDelete.forEach(s => {
    const filePath = path.join(UPLOADS_DIR, s.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Error deleting file:", filePath, err);
      }
    }
  });

  writeDb(db);
  res.json({ success: true, message: "Key and associated screenshots deleted" });
});

// Support: Download all screenshots for a specific key as a zip archive
router.get(['/api/download-all-images', '/api/download-zip/:key'], (req, res) => {
  const keyQuery = (req.params.key || req.query.key || '').trim().toUpperCase();
  if (!keyQuery) {
    return res.status(400).json({ success: false, message: "Key parameter missing" });
  }

  const db = readDb();
  const screenshots = db.screenshots.filter(s => s.key.toUpperCase() === keyQuery);

  if (screenshots.length === 0) {
    return res.status(404).json({ success: false, message: "No screenshots found for this key" });
  }

  const zip = new AdmZip();
  let addedCount = 0;

  screenshots.forEach((s, idx) => {
    const filePath = path.join(UPLOADS_DIR, s.filename);
    if (fs.existsSync(filePath)) {
      let name = `Cau_${idx + 1}.jpg`;
      zip.addLocalFile(filePath, "", name);
      addedCount++;
    }
  });

  if (addedCount === 0) {
    return res.status(404).json({ success: false, message: "No physical screenshot files found on disk" });
  }

  const zipBuffer = zip.toBuffer();
  
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=screenshots_${keyQuery}.zip`);
  res.send(zipBuffer);
});

// Support: Download cropped Data images as a ZIP archive
router.post('/api/download-cropped-zip', (req, res) => {
  const { key, images } = req.body;
  const keyNorm = (key || 'data').trim().toUpperCase();
  
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ success: false, message: "No images provided" });
  }

  const zip = new AdmZip();
  let addedCount = 0;

  images.forEach(img => {
    if (img.name && img.data && img.data.includes('base64,')) {
      const base64Data = img.data.split('base64,')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      zip.addFile(img.name, buffer);
      addedCount++;
    }
  });

  if (addedCount === 0) {
    return res.status(400).json({ success: false, message: "No valid image data" });
  }

  const zipBuffer = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=screenshots_data_${keyNorm}.zip`);
  res.send(zipBuffer);
});

// Support: Save note, answer, or question for a specific screenshot
router.post('/api/save-note', (req, res) => {
  const { screenshotId, note, answer, question } = req.body;
  if (!screenshotId) {
    return res.status(400).json({ success: false, message: "Screenshot ID missing" });
  }
  
  const db = readDb();
  const screenshot = db.screenshots.find(s => s.id === screenshotId);
  if (!screenshot) {
    return res.status(404).json({ success: false, message: "Screenshot not found" });
  }
  
  if (note !== undefined) {
    screenshot.note = note;
  }
  if (answer !== undefined) {
    screenshot.answer = answer;
  }
  if (question !== undefined) {
    screenshot.question = question;
  }
  
  writeDb(db);
  res.json({ success: true, message: "Saved successfully" });
});

// Support: Delete specific screenshot
router.post('/api/delete-screenshot', (req, res) => {
  const { screenshotId } = req.body;
  if (!screenshotId) {
    return res.status(400).json({ success: false, message: "Screenshot ID missing" });
  }
  
  const db = readDb();
  const screenshotIndex = db.screenshots.findIndex(s => s.id === screenshotId);
  if (screenshotIndex === -1) {
    return res.status(404).json({ success: false, message: "Screenshot not found" });
  }
  
  const s = db.screenshots[screenshotIndex];
  const filePath = path.join(UPLOADS_DIR, s.filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error("Error deleting file:", filePath, err);
    }
  }
  
  db.screenshots.splice(screenshotIndex, 1);
  writeDb(db);
  
  res.json({ success: true, message: "Screenshot deleted" });
});

// Serve the support-only panel (no admin features)
router.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'support.html'));
});

module.exports = router;
