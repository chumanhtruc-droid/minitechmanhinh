const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { readDb, writeDb, UPLOADS_DIR } = require('../config/db');
const { requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Public root landing page (index.html)
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

// Protected admin panel (admin.html)
router.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
});

router.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
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
      let durationText = "Vĩnh viễn";
      const h = k.durationHours || 0;
      if (h === 1) durationText = "1 Giờ";
      else if (h === 24) durationText = "24 Giờ (1 Ngày)";
      else if (h === 72) durationText = "72 Giờ (3 Ngày)";
      else if (h === 720) durationText = "720 Giờ (30 Ngày)";
      else if (h === 2880) durationText = "2880 Giờ (120 Ngày)";
      else if (h > 0) durationText = `${h} Giờ`;

      let remainingText = "Chưa kích hoạt";
      if (k.expiresAt) {
        const diffMs = new Date(k.expiresAt).getTime() - Date.now();
        if (diffMs > 0) {
          const totalMinutes = Math.floor(diffMs / 60000);
          const days = Math.floor(totalMinutes / (24 * 60));
          const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
          const mins = totalMinutes % 60;
          if (days > 0) remainingText = `${days}d ${hours}h ${mins}m`;
          else if (hours > 0) remainingText = `${hours}h ${mins}m`;
          else remainingText = `${mins}m`;
        } else {
          remainingText = "Đã hết hạn";
        }
      }

      keyMap.set(normKey, {
        ...k,
        key: normKey,
        durationText,
        remainingTimeText: remainingText,
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

  // Sort keys descending by createdAt (newest keys at the top)
  const sortedKeys = Array.from(keyMap.values()).sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  res.json({ success: true, keys: sortedKeys });
});

// Helper function to delete key and its assets case-insensitively
function deleteKeyFromDb(key) {
  if (!key) return false;
  const keyNorm = key.trim().toUpperCase();
  const db = readDb();
  db.keys = (db.keys || []).filter(k => k.key.toUpperCase() !== keyNorm);
  const screenshotsToDelete = (db.screenshots || []).filter(s => (s.key || '').toUpperCase() === keyNorm);
  db.screenshots = (db.screenshots || []).filter(s => (s.key || '').toUpperCase() !== keyNorm);
  if (db.notes) {
    delete db.notes[keyNorm];
  }
  
  screenshotsToDelete.forEach(s => {
    const filePath = path.join(UPLOADS_DIR, s.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (err) { }
    }
  });

  writeDb(db);
  return true;
}

// Admin: Delete a key
router.post('/api/delete-key', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ success: false, message: "Key parameter missing" });
  deleteKeyFromDb(key);
  res.json({ success: true, message: "Key and associated screenshots deleted" });
});

router.delete('/api/keys/:key', (req, res) => {
  const key = req.params.key;
  if (!key) return res.status(400).json({ success: false, message: "Key parameter missing" });
  deleteKeyFromDb(key);
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
