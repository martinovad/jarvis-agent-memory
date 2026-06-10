import { z } from 'zod';
import path from 'path';
import { walkVault, rel } from '../lib/vault.js';

export default {
  name: 'search_filename',
  config: {
    title: 'Search filenames',
    description: 'Find notes whose filename contains the query string',
    inputSchema: {
      query: z.string().describe('Search string to match against filenames')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ query }) => {
    const q = query.toLowerCase();
    const files = walkVault();
    const matches = files
      .filter(f => path.basename(f).toLowerCase().includes(q))
      .map(f => rel(f));
    const text = matches.length ? matches.join('\n') : 'No matches found';
    return { content: [{ type: 'text', text }] };
  }
};
