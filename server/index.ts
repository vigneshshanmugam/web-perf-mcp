#!/usr/bin/env node

import PerformanceAuditServer from './server.js';

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PerformanceAuditServer();
  server.run().catch(console.error);
}

export default PerformanceAuditServer;