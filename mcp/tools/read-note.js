import { z } from 'zod';
import fs from 'fs';
import { safePath } from '../lib/vault.js';

export default {
  name: 'read_note',
  config: {
    title: 'Read note',
    description: 'Read the full content of a vault note by path',
    inputSchema: {
      path: z.string().describe('File path relative to vault root (e.g. Projects/Jarvis/CLAUDE.md)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ path: notePath }) => {
    const full = safePath(notePath);
    const text = fs.readFileSync(full, 'utf8');
    return { content: [{ type: 'text', text }] };
  }
};
