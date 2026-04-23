require('dotenv').config();

const express  = require('express');
const morgan   = require('morgan');
const helmet   = require('helmet');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const winston  = require('winston');
const prom     = require('prom-client');

const pool              = require('./db/pool');
const { startConsumer } = require('./mq/consumer');
const logger            = require('./utils/logger');


const app  = express();
const PORT = process.env.PORT || 5003;

// ── Metrics ───────────────────────────────────────────
const register = new prom.Registry();
prom.collectDefaultMetrics({ register });
const httpRequestsTotal = new prom.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// ── Logger is now in utils/logger.js ─────────────────


// ── Security ──────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Metrics middleware ────────────────────────────────
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestsTotal.inc({ method: req.method, route: req.path, status: res.statusCode });
  });
  next();
});

// ── Auth middleware ───────────────────────────────────
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded  = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.userId     = decoded.id;
    req.userRole   = decoded.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ── Observability ─────────────────────────────────────
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/health', (_req, res) =>
  res.json({ status: 'healthy', service: 'notification-service', timestamp: new Date().toISOString() })
);

// ── List notifications for current user ───────────────
app.get('/api/v1/notifications', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id AS "userId", type, title, message, read,
              created_at AS "createdAt"
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error(`List notifications error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ── Mark notification as read ─────────────────────────
app.patch('/api/v1/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, type, title, message, read, created_at AS "createdAt"`,
      [parseInt(req.params.id), req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error(`Mark-read error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ── Mark all as read ──────────────────────────────────
app.patch('/api/v1/notifications/read-all', verifyToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE',
      [req.userId]
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    logger.error(`Mark-all-read error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ── 404 ───────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Startup ───────────────────────────────────────────
const start = async () => {
  // Wait for PostgreSQL
  let retries = 10;
  while (retries) {
    try {
      await pool.query('SELECT 1');
      logger.info('✅ Database connected');
      break;
    } catch (err) {
      retries--;
      logger.warn(`DB not ready — retrying in 3s (${retries} left): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!retries) {
    logger.error('Could not connect to database. Exiting.');
    process.exit(1);
  }

  // Start RabbitMQ consumer (non-blocking — will retry on its own)
  startConsumer().catch((err) => logger.warn(`Consumer startup warning: ${err.message}`));

  app.listen(PORT, () => logger.info(`🔔 Notification Service listening on port ${PORT}`));
};

start();
