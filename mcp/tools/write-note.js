import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { writablePath, writeFileAtomic } from '../lib/vault.js';

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
    // Brain.md is the append-only session index: write_note would replace every row, so rows go
    // through append_note (which also refuses to create a missing file).
    if (path.basename(notePath).toLowerCase() === 'brain.md') {
      throw new Error(`Brain.md is append-only: use append_note with path "Brain.md" (refused: ${notePath})`);
    }
    const full = writablePath(notePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    writeFileAtomic(full, content);
    return { content: [{ type: 'text', text: `Written: ${notePath}` }] };
  }
};
