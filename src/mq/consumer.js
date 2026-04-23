const amqp   = require('amqplib');
const pool   = require('../db/pool');
const logger = require('../utils/logger');

const QUEUE = 'notifications';
const URL   = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

/* ── Start consumer with auto-reconnect ─────────────────── */
async function startConsumer() {
  const tryConnect = async () => {
    try {
      const conn = await amqp.connect(URL);
      const ch   = await conn.createChannel();
      await ch.assertQueue(QUEUE, { durable: true });
      ch.prefetch(1); // process one message at a time

      logger.info('RabbitMQ consumer connected ✓ — waiting for notifications…');

      ch.consume(QUEUE, async (msg) => {
        if (!msg) return;

        let payload;
        try {
          payload = JSON.parse(msg.content.toString());
        } catch {
          logger.error('Invalid message format, discarding');
          ch.nack(msg, false, false); // dead-letter, don't requeue
          return;
        }

        const { userId, type = 'info', title, message } = payload;

        if (!userId || !title) {
          logger.warn('Notification missing userId or title, discarding');
          ch.nack(msg, false, false);
          return;
        }

        try {
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES ($1, $2, $3, $4)`,
            [userId, type, title, message || '']
          );
          ch.ack(msg);
          logger.info(`Notification stored → user ${userId}: "${title}"`);
        } catch (err) {
          logger.error(`DB insert failed: ${err.message} — requeuing`);
          ch.nack(msg, false, true); // requeue on DB error
        }
      });

      /* ── Auto-reconnect on connection drop ─── */
      conn.on('error', (err) => {
        logger.warn(`RabbitMQ consumer error: ${err.message}. Reconnecting in 5s…`);
        setTimeout(tryConnect, 5_000);
      });
      conn.on('close', () => {
        logger.warn('RabbitMQ consumer connection closed. Reconnecting in 5s…');
        setTimeout(tryConnect, 5_000);
      });
    } catch (err) {
      logger.warn(`RabbitMQ consumer connect failed: ${err.message}. Retrying in 5s…`);
      setTimeout(tryConnect, 5_000);
    }
  };

  await tryConnect();
}

module.exports = { startConsumer };
