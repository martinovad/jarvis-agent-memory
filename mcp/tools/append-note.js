import { z } from 'zod';
import fs from 'fs';
import { safePath } from '../lib/vault.js';

export default {
  name: 'append_note',
  config: {
    title: 'Append to note',
    description: 'Append content to the end of an existing vault note',
    inputSchema: {
      path: z.string().describe('File path relative to vault root'),
      content: z.string().describe('Content to append')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  handler: async ({ path: notePath, content }) => {
    const full = safePath(notePath);
    const existing = fs.readFileSync(full, 'utf8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(full, sep + content, 'utf8');
    return { content: [{ type: 'text', text: `Appended to: ${notePath}` }] };
  }
};
