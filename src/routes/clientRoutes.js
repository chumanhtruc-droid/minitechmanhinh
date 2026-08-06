const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { readDb, writeDb, UPLOADS_DIR } = require('../config/db');

const router = express.Router();

// Multer configuration for screenshot uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `screenshot_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Client & Support: Verify activation key (starts expiry timer on first call)
router.get('/api/verify-key', (req, res) => {
  const keyQuery = (req.query.key || '').trim().toUpperCase();
  const hwidQuery = (req.query.hwid || '').trim();

  if (!keyQuery) {
    return res.json({ success: false, message: "Key parameter missing" });
  }

  const db = readDb();
  const keyObj = db.keys.find(k => k.key.toUpperCase() === keyQuery && k.status === 'active');

  if (!keyObj) {
    return res.json({ success: false, message: "Key không hợp lệ hoặc đã hết hạn" });
  }

  // HWID Hardware Lock Check: Bind Key to specific computer on first activation
  if (hwidQuery) {
    if (!keyObj.hwid) {
      keyObj.hwid = hwidQuery;
      writeDb(db);
      console.log(`[HWID Lock] 🔒 Key ${keyObj.key} bound to hardware ID: ${hwidQuery}`);
    } else if (keyObj.hwid !== hwidQuery) {
      console.warn(`[HWID Lock Error] ⛔ Key ${keyObj.key} attempted on unauthorized machine ${hwidQuery} (bound to ${keyObj.hwid})`);
      return res.json({
        success: false,
        message: "Key này đã được kích hoạt trên một máy tính khác! Mỗi Key chỉ sử dụng duy nhất trên 1 máy."
      });
    }
  }

  const now = Date.now();

  // First activation — start the expiry clock
  if (!keyObj.activatedAt && keyObj.durationHours > 0) {
    keyObj.activatedAt = new Date().toISOString();
    keyObj.expiresAt = new Date(now + keyObj.durationHours * 3600 * 1000).toISOString();
    writeDb(db);
    console.log(`[Key] ${keyObj.key} activated — expires ${keyObj.expiresAt}`);
  }

  // Check expiry
  if (keyObj.expiresAt && now > new Date(keyObj.expiresAt).getTime()) {
    keyObj.status = 'expired';
    writeDb(db);
    console.log(`[Key] ${keyObj.key} expired`);
    return res.json({ success: false, message: "Key has expired" });
  }

  let remainingText = "Không giới hạn";
  if (keyObj.expiresAt) {
    const diffMs = new Date(keyObj.expiresAt).getTime() - now;
    if (diffMs > 0) {
      const totalMinutes = Math.floor(diffMs / 60000);
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const mins = totalMinutes % 60;

      if (days > 0) {
        remainingText = `${days} ngày ${hours} giờ ${mins} phút`;
      } else if (hours > 0) {
        remainingText = `${hours} giờ ${mins} phút`;
      } else {
        remainingText = `${mins} phút`;
      }
    } else {
      remainingText = "Đã hết hạn";
    }
  }

  res.json({
    success: true,
    message: "Key is valid",
    expiresAt: keyObj.expiresAt || null,
    durationHours: keyObj.durationHours || 0,
    remainingTimeText: remainingText
  });
});

// Client: Upload screenshot (takes multipart form-data with fields: 'key', 'image')
router.post('/api/upload-screenshot', upload.single('image'), async (req, res) => {
  const key = (req.body.key || '').trim().toUpperCase();
  if (!key) {
    return res.status(400).json({ success: false, message: "Key is required" });
  }
  
  const db = readDb();
  let keyExists = db.keys.find(k => k.key.toUpperCase() === key);
  if (!keyExists) {
    keyExists = {
      key: key,
      createdAt: new Date().toISOString(),
      status: 'active',
      durationHours: 24,
      activatedAt: new Date().toISOString(),
      expiresAt: null
    };
    db.keys.push(keyExists);
    writeDb(db);
  } else if (keyExists.status !== 'active') {
    keyExists.status = 'active';
    writeDb(db);
  }
  
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file provided" });
  }

  // Upload to Cloudinary Cloud Server if configured
  const { uploadToCloudinary } = require('../config/cloudinary');
  let cloudUrl = null;
  try {
    cloudUrl = await uploadToCloudinary(req.file.path);
  } catch (e) { }
  
  // Auto assign sequential question label (Câu 1, Câu 2, Câu 3...)
  const existingScreenshots = db.screenshots.filter(s => s.key.toUpperCase() === key);
  const qNum = existingScreenshots.length + 1;
  const questionLabel = `Câu ${qNum}`;

  const screenshotId = uuidv4();
  const finalUrl = cloudUrl || `/uploads/${req.file.filename}`;

  const newScreenshot = {
    id: screenshotId,
    key: key,
    filename: req.file.filename,
    url: finalUrl,
    note: "",
    question: questionLabel,
    createdAt: new Date().toISOString()
  };
  
  db.screenshots.push(newScreenshot);
  writeDb(db);
  
  console.log(`[Upload] 📸 New screenshot received for ${key}: ${questionLabel} (${finalUrl})`);
  res.json({
    success: true,
    screenshotId: screenshotId,
    filename: req.file.filename,
    url: finalUrl,
    question: questionLabel,
    message: "Screenshot uploaded successfully"
  });
});

// Support & Client: Get screenshots and notes for a specific key
router.get('/api/get-notes', (req, res) => {
  const keyQuery = (req.query.key || '').trim().toUpperCase();
  if (!keyQuery) {
    return res.status(400).json({ success: false, message: "Key parameter missing" });
  }
  
  const db = readDb();
  if (!db.notes) db.notes = {};
  const screenshots = (db.screenshots || [])
    .filter(s => s.key.toUpperCase() === keyQuery)
    .map(s => ({
      ...s,
      url: s.url || `/uploads/${s.filename}`
    }));
  const note = db.notes[keyQuery] || '';

  res.json({ success: true, note, screenshots });
});

// Support & Client: Get note for specific key
router.get('/api/notes/:key', (req, res) => {
  const keyQuery = (req.params.key || '').trim().toUpperCase();
  const db = readDb();
  if (!db.notes) db.notes = {};
  const note = db.notes[keyQuery] || '';
  res.json({ success: true, note });
});

// Support & Client: Get screenshots for a specific key
router.get('/api/screenshots/:key', (req, res) => {
  const keyQuery = (req.params.key || '').trim().toUpperCase();
  const db = readDb();
  const screenshots = (db.screenshots || [])
    .filter(s => s.key.toUpperCase() === keyQuery)
    .map(s => ({
      ...s,
      url: s.url || `/uploads/${s.filename}`
    }));
  res.json({ success: true, screenshots });
});

// Support & Client: Save/Append note or chat message for specific key
router.post('/api/notes', (req, res) => {
  const { key, note } = req.body;
  const keyNorm = (key || '').trim().toUpperCase();
  if (!keyNorm) return res.status(400).json({ success: false, message: "Key missing" });

  const db = readDb();
  if (!db.notes) db.notes = {};
  
  if (note !== undefined) {
    if (db.notes[keyNorm]) {
      db.notes[keyNorm] = db.notes[keyNorm] + "\n" + note;
    } else {
      db.notes[keyNorm] = note;
    }
    writeDb(db);
  }
  
  res.json({ success: true, note: db.notes[keyNorm] || '' });
});

// Client: Clear all screenshots and chat history for a key on fresh key activation
router.post('/api/clear-history', (req, res) => {
  const key = (req.body.key || '').trim().toUpperCase();
  if (!key) {
    return res.status(400).json({ success: false, message: "Key is required" });
  }

  const db = readDb();
  const toDelete = (db.screenshots || []).filter(s => s.key.toUpperCase() === key);

  toDelete.forEach(s => {
    const filePath = path.join(UPLOADS_DIR, s.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (err) { /* ignore */ }
    }
  });

  db.screenshots = (db.screenshots || []).filter(s => s.key.toUpperCase() !== key);
  
  if (db.notes) {
    delete db.notes[key];
  }

  writeDb(db);

  console.log(`[History & Chat Cleared] Wiped ${toDelete.length} screenshots and chat history for key ${key}`);
  res.json({ success: true, cleared: toDelete.length });
});

module.exports = router;
