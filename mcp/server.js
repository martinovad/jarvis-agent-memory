import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import readNote from './tools/read-note.js';
import writeNote from './tools/write-note.js';
import appendNote from './tools/append-note.js';
import listFolder from './tools/list-folder.js';
import searchFilename from './tools/search-filename.js';
import searchContent from './tools/search-content.js';
import searchFrontmatter from './tools/search-frontmatter.js';
import readFrontmatter from './tools/read-frontmatter.js';
import listRecent from './tools/list-recent.js';
import pickResumeSessions from './tools/pick-resume-sessions.js';

const tools = [
  readNote,
  writeNote,
  appendNote,
  listFolder,
  searchFilename,
  searchContent,
  searchFrontmatter,
  readFrontmatter,
  listRecent,
  pickResumeSessions
];

// Wraps a tool handler so any thrown error becomes a structured error response
// with the same "Error: <msg>" wire format the legacy if/else dispatcher used.
function wrapHandler(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    }
  };
}

const server = new McpServer({ name: 'jarvis-mcp', version: '1.1.0' });

for (const tool of tools) {
  server.registerTool(tool.name, tool.config, wrapHandler(tool.handler));
}

const transport = new StdioServerTransport();
await server.connect(transport);
