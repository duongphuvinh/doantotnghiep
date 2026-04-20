import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGioiThieu ,registerToolNew, registerToolTask, registerToolVerifyAnswer} from '../mcp-tool/tool';


export const MCPServer = new McpServer({  name: 'mcp-server',  version: '1.0.0'});

registerGioiThieu(MCPServer);
registerToolNew(MCPServer);
registerToolTask(MCPServer);
registerToolVerifyAnswer(MCPServer);