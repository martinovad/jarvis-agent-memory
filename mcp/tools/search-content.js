import { z } from 'zod';
import fs from 'fs';
import { walkVault, rel } from '../lib/vault.js';

export default {
  name: 'search_content',
  config: {
    title: 'Search content',
    description: 'Full-text search across all vault notes. Returns matching files with surrounding context.',
    inputSchema: {
      query: z.string().describe('Text to search for across all notes'),
      max_results: z.number().int().positive().optional().describe('Maximum results to return (default: 10)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ query, max_results }) => {
    const q = query.toLowerCase();
    const max = max_results || 10;
    const files = walkVault();
    const matches = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lower = content.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(content.length, idx + q.length + 60);
        const snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
        matches.push(`${rel(file)}\n  → ...${snippet}...`);
        if (matches.length >= max) break;
      }
    }
    const text = matches.length ? matches.join('\n\n') : 'No matches found';
    return { content: [{ type: 'text', text }] };
  }
};
