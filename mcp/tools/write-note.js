import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { safePath } from '../lib/vault.js';

export default {
  name: 'write_note',
  config: {
    title: 'Write note',
    description: 'Create or fully overwrite a vault note',
    inputSchema: {
      path: z.string().describe('File path relative to vault root'),
      content: z.string().describe('Full file content to write')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ path: notePath, content }) => {
    const full = safePath(notePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return { content: [{ type: 'text', text: `Written: ${notePath}` }] };
  }
};
