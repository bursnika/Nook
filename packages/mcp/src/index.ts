#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NookClient, loadConfig } from './client.js';
import { createServer } from './server.js';

// stdout carries the MCP protocol: all diagnostics go to stderr
const config = loadConfig();
if (!config.token) console.error('nook-mcp: NOOK_TOKEN is not set, API calls will fail');
if (!config.workspaceId) {
  console.error('nook-mcp: NOOK_WORKSPACE_ID is not set, tools will need a workspaceId argument');
}

const server = createServer(new NookClient(config));
await server.connect(new StdioServerTransport());
console.error(`nook-mcp: ready (API ${config.apiUrl})`);
