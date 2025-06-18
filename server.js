// rest-server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const ngrok = require('ngrok');
let publicURL = null;


const app = express();
const PORT = process.env.PORT || 4242;

const {
  GP_MERCHANT_ID,
  GP_ACCOUNT,
  GP_SHARED_SECRET,
  GP_ENV,
  GP_API_KEY,
  GP_BASE_URL
} = process.env;

if (!GP_MERCHANT_ID || !GP_ACCOUNT || !GP_SHARED_SECRET || !GP_ENV) {
  console.error('❌ Missing required env vars (GP_MERCHANT_ID, GP_ACCOUNT, GP_SHARED_SECRET, GP_ENV)');
  process.exit(1);
}

const LOG_FILE = './data/transactions.json';
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function logTransaction(data) {
  let logs = [];
  if (fs.existsSync(LOG_FILE)) logs = JSON.parse(fs.readFileSync(LOG_FILE));
  logs.push({ ...data, timestamp: new Date().toISOString() });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// HPP Session payload generator
app.post('/api/gp/create-session', (req, res) => {
  const ORDER_ID = `order${Date.now()}`;
  const AMOUNT = req.body.amount || '4999';
  const CURRENCY = req.body.currency || 'EUR';
  const TIMESTAMP = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

  const hashInput = `${TIMESTAMP}.${GP_MERCHANT_ID}.${ORDER_ID}.${AMOUNT}.${CURRENCY}`;
  const firstHash = crypto.createHash('sha1').update(hashInput, 'utf8').digest('hex');
  const finalHash = crypto.createHash('sha1').update(`${firstHash}.${GP_SHARED_SECRET}`, 'utf8').digest('hex');

const payload = {
  MERCHANT_ID: GP_MERCHANT_ID,
  ACCOUNT: GP_ACCOUNT,
  ORDER_ID,
  AMOUNT,
  CURRENCY,
  TIMESTAMP,
  SHA1HASH: finalHash,
  AUTO_SETTLE_FLAG: '1',
  MERCHANT_RESPONSE_URL: publicURL ? `${publicURL}/return.html` : '',
  MERCHANT_FAILURE_URL: publicURL ? `${publicURL}/fail.html` : ''
};


  console.log('🧾 Generated session payload:', payload);
  logTransaction({ type: 'create-session', orderId: ORDER_ID, amount: AMOUNT, currency: CURRENCY });
  res.json(payload);
});

// Transaction lookup (only works with REST-style setups)
app.post('/api/gp/get-transaction', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  const queryUrl = `${GP_BASE_URL}/v1/${GP_MERCHANT_ID}/orders/${orderId}`;

  try {
    const response = await axios.get(queryUrl, {
      headers: { Authorization: `Bearer ${GP_API_KEY}` }
    });
    res.json(response.data);
  } catch (err) {
    console.error('❌ Transaction lookup failed:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
  }
});

// Refund (rebate via XML)
app.post('/api/gp/refund', async (req, res) => {
  const { orderId, pasref, authcode, amount, currency } = req.body;
  if (!orderId || !pasref || !authcode || !amount || !currency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const hashBase = `${timestamp}.${GP_MERCHANT_ID}.${orderId}.${amount}.${currency}.${pasref}.${authcode}`;
  const hash = crypto.createHash('sha1').update(
    crypto.createHash('sha1').update(hashBase).digest('hex') + '.' + GP_SHARED_SECRET
  ).digest('hex');

  const xml = `
<request type="rebate" timestamp="${timestamp}">
  <merchantid>${GP_MERCHANT_ID}</merchantid>
  <account>${GP_ACCOUNT}</account>
  <orderid>${orderId}</orderid>
  <pasref>${pasref}</pasref>
  <authcode>${authcode}</authcode>
  <amount currency="${currency}">${amount}</amount>
  <sha1hash>${hash}</sha1hash>
</request>`.trim();

  try {
    const response = await axios.post(GP_BASE_URL, xml, {
      headers: { 'Content-Type': 'text/xml' }
    });
    logTransaction({ type: 'refund', orderId, pasref, amount, currency });
    res.type('text/xml').send(response.data);
  } catch (err) {
    console.error('❌ Refund failed:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Void (via XML)
app.post('/api/gp/void', async (req, res) => {
  const { orderId, pasref } = req.body;

  if (!orderId || !pasref) {
    return res.status(400).json({ error: 'Missing orderId or pasref' });
  }

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const hashInput = `${timestamp}.${GP_MERCHANT_ID}.${orderId}.${pasref}`;
  const firstHash = crypto.createHash('sha1').update(hashInput, 'utf8').digest('hex');
  const finalHashInput = `${firstHash}.${GP_SHARED_SECRET}`;
  const sha1hash = crypto.createHash('sha1').update(finalHashInput, 'utf8').digest('hex');

  console.log('🧩 [VOID] Hash Input Base:', hashInput);
  console.log('🔐 [VOID] First SHA1:', firstHash);
  console.log('🔐 [VOID] Final Hash Input:', finalHashInput);
  console.log('✅ [VOID] SHA1HASH:', sha1hash);

  const xml = `
<request type="void" timestamp="${timestamp}">
  <merchantid>${GP_MERCHANT_ID}</merchantid>
  <account>${GP_ACCOUNT}</account>
  <orderid>${orderId}</orderid>
  <pasref>${pasref}</pasref>
  <sha1hash>${sha1hash}</sha1hash>
</request>`.trim();

  console.log('📤 [VOID] XML Request:', xml);

  try {
    const response = await axios.post(GP_BASE_URL, xml, {
      headers: { 'Content-Type': 'text/xml' }
    });

    console.log('✅ [VOID] Response:', response.data);

    logTransaction({ type: 'void', orderId, pasref });
    res.type('text/xml').send(response.data);
  } catch (err) {
    const errorData = err.response?.data || err.message;
    const statusCode = err.response?.status || 500;
    console.error('❌ [VOID] Request Failed:', errorData);
    res.status(statusCode).json({ error: errorData });
  }
});


// Capture (NOT SUPPORTED with HPP auto-settle, kept for structure)
app.post('/api/gp/capture', async (req, res) => {
  return res.status(400).json({ error: 'Capture not supported in HPP auto-settle mode.' });
});

// Get all logged transactions
app.get('/api/gp/all-transactions', (req, res) => {
  const logs = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE)) : [];
  res.json(logs);
});

// Save log file to ./data/logs/
app.post('/api/gp/save-log', (req, res) => {
  const { log } = req.body;
  if (!log) return res.status(400).json({ error: 'Missing log content' });

  const logsDir = path.join(__dirname, 'data', 'logs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDir, `realex-log-${timestamp}.txt`);

  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(filePath, log);
    res.json({ message: 'Log saved', file: filePath });
  } catch (err) {
    console.error('❌ Failed to save log file:', err);
    res.status(500).json({ error: 'Failed to write log file' });
  }
});


app.listen(PORT, async () => {
  console.log(`✅ REST server running on http://localhost:${PORT}`);

  try {
publicURL = await ngrok.connect({
  addr: PORT,
  proto: 'http',
  onStatusChange: status => console.log(`⏳ ngrok status: ${status}`),
  onLogEvent: data => console.log(data),
});

    console.log(`🌍 Public URL via ngrok: ${publicURL}`);
  } catch (err) {
    console.error('❌ Failed to launch ngrok:', err.message);
  }
});

