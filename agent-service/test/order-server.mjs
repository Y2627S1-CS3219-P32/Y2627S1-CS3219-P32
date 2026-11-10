import { app } from '../../order-service/dist/app.js';
import { pool } from '../../order-service/dist/db/index.js';
import { setPublisher } from '../../order-service/dist/events/pubsub.js';
setPublisher(async () => {});
const server = app.listen(Number(process.env.PORT), '127.0.0.1');
process.once('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => {
    void pool.end();
  });
});
