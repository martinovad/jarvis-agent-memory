import { z } from 'zod';
import fs from 'fs';
import { safePath } from '../lib/vault.js';

export default {
  name: 'list_folder',
  config: {
    title: 'List folder',
    description: 'List files and subfolders in a vault directory',
    inputSchema: {
      folder: z.string().optional().describe('Folder path relative to vault root. Leave empty for vault root.')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ folder }) => {
    const full = safePath(folder || '');
    const entries = fs.readdirSync(full, { withFileTypes: true });
    const text = entries
      .map(e => e.isDirectory() ? e.name + '/' : e.name)
      .join('\n');
    return { content: [{ type: 'text', text }] };
  }
};
