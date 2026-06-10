import { z } from 'zod';
import fs from 'fs';
import { walkVault, rel, parseFrontmatter } from '../lib/vault.js';

export default {
  name: 'search_frontmatter',
  config: {
    title: 'Search frontmatter',
    description: 'Find notes where a frontmatter key contains a given value (e.g. type=session, project=Jarvis)',
    inputSchema: {
      key: z.string().describe('Frontmatter key to search (e.g. type, project, status)'),
      value: z.string().describe('Value to match (partial match, case-insensitive)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ key, value }) => {
    const files = walkVault();
    const matches = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const fm = parseFrontmatter(content);
      const val = fm[key];
      if (val && val.toLowerCase().includes(value.toLowerCase())) {
        matches.push(rel(file));
      }
    }
    const text = matches.length ? matches.join('\n') : 'No matches found';
    return { content: [{ type: 'text', text }] };
  }
};
