#!/usr/bin/env node

import { WebPerformanceProfilerServer } from './server.js';

const server = new WebPerformanceProfilerServer();
server.run().catch(console.error);