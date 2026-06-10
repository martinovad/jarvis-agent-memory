import { z } from 'zod';
import fs from 'fs';
import { safePath } from '../lib/vault.js';

export default {
  name: 'read_frontmatter',
  config: {
    title: 'Read frontmatter',
    description: 'Read only the YAML frontmatter block of a note — fast and low token cost',
    inputSchema: {
      path: z.string().describe('File path relative to vault root')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ path: notePath }) => {
    const full = safePath(notePath);
    const content = fs.readFileSync(full, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const text = match ? match[0] : 'No frontmatter found';
    return { content: [{ type: 'text', text }] };
  }
};
