import { experimental_createMCPClient as createMCPClient } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'; // Assuming you are using this transport

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface MCPServerConfig {
  url: string;
  type: 'sse' | 'stdio';
  command?: string;
  args?: string[];
  env?: KeyValuePair[];
  headers?: KeyValuePair[];
}

export interface MCPClientManager {
  tools: Record<string, any>;
  clients: any[];
  cleanup: () => Promise<void>;
}

/**
 * Initialize MCP clients for API calls
 * This uses the already running persistent SSE servers
 */
export async function initializeMCPClients(
  mcpServers: MCPServerConfig[] = [],
  abortSignal?: AbortSignal
): Promise<MCPClientManager> {
  // Initialize tools
  let tools = {};
  const mcpClients: any[] = [];
  const mcpServerUrl = "http://localhost:3000/api/mcp"; // Replace with your MCP server URL
  // Process each MCP server configuration
  try {
    // Tạo transport SSE cho MCP server
    const transport = new StreamableHTTPClientTransport(
      new URL(mcpServerUrl),
      {
        requestInit: {
          headers: {
            
          }
        }
      }
    );

    // Tạo MCP client
    const mcpClient = await createMCPClient({ transport });
    mcpClients.push(mcpClient);

    // Lấy danh sách tool
    const mcptools = await mcpClient.tools();
    console.log(`MCP tools from ${mcpServerUrl}:`, Object.keys(mcptools));

    // Merge tools
    tools = { ...tools, ...mcptools };

  } catch (error) {
    console.error("Failed to initialize MCP client:", error);
    // Không để fail toàn bộ vòng lặp, tiếp tục với server khác
  }


  // Register cleanup for all clients if an abort signal is provided
  if (abortSignal && mcpClients.length > 0) {
    abortSignal.addEventListener('abort', async () => {
      await cleanupMCPClients(mcpClients);
    });
  }

  return {
    tools,
    clients: mcpClients,
    cleanup: async () => await cleanupMCPClients(mcpClients)
  };
}

async function cleanupMCPClients(clients: any[]): Promise<void> {
  // Clean up the MCP clients
  for (const client of clients) {
    try {
      await client.close();
    } catch (error) {
      console.error("Error closing MCP client:", error);
    }
  }
} 