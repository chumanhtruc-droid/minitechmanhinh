const fs = require('fs');
const https = require('https');

let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloudinary_url: process.env.CLOUDINARY_URL
    });
  } else if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
} catch (e) {
  console.warn("[Cloudinary] SDK package missing or optional, using direct cloud HTTPS upload");
}

async function uploadToCloudinary(filePath) {
  try {
    // 1. If Cloudinary SDK & Env Vars are configured, use Cloudinary SDK
    if (cloudinary && (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME)) {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'minitech_screenshots',
        resource_type: 'image',
        quality: 'auto:eco'
      });

      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { }
      }

      return result.secure_url;
    }

    // 2. Out-Of-The-Box Automatic Free Cloud Image Storage (Zero-Config)
    if (!fs.existsSync(filePath)) return null;
    const base64Data = fs.readFileSync(filePath, { encoding: 'base64' });
    const postData = `key=6d207e02198a847aa98d0a2a901485a5&image=${encodeURIComponent(base64Data)}`;

    const cdnUrl = await new Promise((resolve) => {
      const req = https.request('https://api.imgbb.com/1/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json && json.data && (json.data.url || json.data.display_url)) {
              resolve(json.data.url || json.data.display_url);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', (err) => {
        console.error("Cloud image upload request error:", err.message);
        resolve(null);
      });
      req.write(postData);
      req.end();
    });

    if (cdnUrl && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { }
    }

    return cdnUrl;
  } catch (err) {
    console.error("[Cloud Image Upload Error]:", err.message);
    return null;
  }
}

module.exports = {
  cloudinary,
  uploadToCloudinary
};
