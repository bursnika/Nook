import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NookClient } from './client.js';
import { registerTools } from './tools.js';

export function createServer(client: NookClient, now?: () => Date): McpServer {
  const server = new McpServer({ name: 'nook', version: '0.1.0' });
  registerTools(server, { client, now });
  return server;
}
