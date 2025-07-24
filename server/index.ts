#!/usr/bin/env node

import { WebPerformanceProfilerServer } from './server.js';

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new WebPerformanceProfilerServer();
  server.run().catch(console.error);
}