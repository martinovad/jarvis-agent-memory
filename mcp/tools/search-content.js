import { z } from 'zod';
import { searchVault, formatResults } from '../lib/fts.js';

export default {
  name: 'search_content',
  config: {
    title: 'Search content',
    description: 'Ranked full-text search across vault notes (SQLite FTS5, bm25 with recency weighting). Returns the best-matching note sections with a snippet and heading; read that section, not the whole note.',
    inputSchema: {
      query: z.string().describe('Search terms; a trailing * on a term does prefix matching'),
      max_results: z.number().int().positive().optional().describe('Maximum results to return (default: 10)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ query, max_results }) => {
    const results = searchVault(query, max_results || 10);
    const text = results.length ? formatResults(results) : 'No matches found';
    return { content: [{ type: 'text', text }] };
  }
};
