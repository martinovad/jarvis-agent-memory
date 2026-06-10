import { z } from 'zod';
import fs from 'fs';
import { walkVault, rel } from '../lib/vault.js';

export default {
  name: 'list_recent',
  config: {
    title: 'List recent notes',
    description: 'List the most recently modified notes in the vault',
    inputSchema: {
      n: z.number().int().positive().optional().describe('Number of files to return (default: 5)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ n }) => {
    const count = n || 5;
    const files = walkVault();
    const withMtime = files.map(f => ({ f, mtime: fs.statSync(f).mtimeMs }));
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const text = withMtime
      .slice(0, count)
      .map(({ f, mtime }) => {
        const date = new Date(mtime).toISOString().slice(0, 10);
        return `${date}  ${rel(f)}`;
      })
      .join('\n');
    return { content: [{ type: 'text', text }] };
  }
};
