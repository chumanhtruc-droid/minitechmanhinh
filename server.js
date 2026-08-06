const express = require('express');
const cors = require('cors');
const path = require('path');

const { UPLOADS_DIR } = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const clientRoutes = require('./src/routes/clientRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded screenshots (public - clients need this)
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve static files EXCEPT index.html for admin (we protect index.html via adminRoutes)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Mount Modular Routes
app.use('/', authRoutes);
app.use('/', clientRoutes);
app.use('/', adminRoutes);

app.listen(PORT, () => {
  console.log(`Support Server is running on port ${PORT}`);
});
