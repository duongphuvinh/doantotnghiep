import type { NextApiRequest, NextApiResponse } from 'next';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { randomUUID } from 'node:crypto';
import { MCPServer } from '@/src/mcp-server/mcp';


// Store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Handler for GET and DELETE — requires active session
const handleSessionRequest = async (req: NextApiRequest, res: NextApiResponse) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {


    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    // Reuse existing session
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    }
    // New initialization
    else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
        },
        // enableDnsRebindingProtection: true,
        // allowedHosts: ['127.0.0.1'],
      });

      // Cleanup when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      await MCPServer.connect(transport);
    }
    // Invalid request
    else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
    return;
  }

  // For GET / DELETE
  await handleSessionRequest(req, res);
}


