import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';

const EditFileSchema = z.object({
  file_path: z.string().describe('Absolute path to the file to edit'),
  old_string: z.string().describe('The exact text to find and replace. Must match uniquely in the file.'),
  new_string: z.string().describe('The replacement text'),
});

/**
 * Normalize a string for fuzzy matching.
 * Handles Unicode smart quotes, dashes, and whitespace that LLMs commonly produce.
 */
function normalizeForFuzzy(s: string): string {
  return s
    // Smart quotes → ASCII
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Unicode dashes → ASCII hyphen
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    // Unicode whitespace → regular space
    .replace(/[\u00A0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u3000]/g, ' ')
    // Strip BOM
    .replace(/\uFEFF/g, '')
    // Normalize trailing whitespace per line
    .replace(/[ \t]+$/gm, '');
}

/**
 * Count occurrences of needle in haystack.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Find the line number where a substring starts.
 */
function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Generate a compact diff snippet showing the change with line numbers.
 */
function generateDiff(
  file_path: string,
  oldContent: string,
  newContent: string,
  changeIndex: number,
  oldStr: string,
  newStr: string
): string {
  const contextLines = 3;
  const startLine = getLineNumber(oldContent, changeIndex);

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Get context before the change
  const allOldLines = oldContent.split('\n');
  const contextStart = Math.max(0, startLine - 1 - contextLines);

  let diff = `--- ${file_path}\n+++ ${file_path}\n`;
  diff += `@@ -${contextStart + 1},${oldLines.length + contextLines * 2} @@\n`;

  // Context before
  for (let i = contextStart; i < startLine - 1; i++) {
    diff += ` ${allOldLines[i]}\n`;
  }

  // Removed lines
  for (const line of oldLines) {
    diff += `-${line}\n`;
  }

  // Added lines
  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  // Context after
  const afterStart = startLine - 1 + oldLines.length;
  const afterEnd = Math.min(allOldLines.length, afterStart + contextLines);
  for (let i = afterStart; i < afterEnd; i++) {
    diff += ` ${allOldLines[i]}\n`;
  }

  return diff;
}

export function createEditFileTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { file_path, old_string, new_string } = input;

      if (old_string === new_string) {
        return 'Error: old_string and new_string are identical. No change needed.';
      }

      let content: string;
      try {
        content = await fs.readFile(file_path, 'utf-8');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) {
          return `Error: File not found: ${file_path}`;
        }
        return `Error reading file: ${msg}`;
      }

      // Detect original line endings
      const useCRLF = content.includes('\r\n');

      // Try exact match first
      const exactCount = countOccurrences(content, old_string);

      if (exactCount === 1) {
        const idx = content.indexOf(old_string);
        const updated = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
        await fs.writeFile(file_path, updated, 'utf-8');
        const diff = generateDiff(file_path, content, updated, idx, old_string, new_string);
        return `Successfully edited ${file_path}\n\n${diff}`;
      }

      if (exactCount > 1) {
        const line = getLineNumber(content, content.indexOf(old_string));
        return `Error: old_string matches ${exactCount} locations in the file. Include more surrounding context to make the match unique. First match is at line ${line}.`;
      }

      // No exact match — try fuzzy matching
      const normalizedContent = normalizeForFuzzy(content);
      const normalizedOld = normalizeForFuzzy(old_string);
      const fuzzyCount = countOccurrences(normalizedContent, normalizedOld);

      if (fuzzyCount === 0) {
        return `Error: old_string not found in ${file_path}. Verify the text exists in the file and try again.`;
      }

      if (fuzzyCount > 1) {
        return `Error: old_string matches ${fuzzyCount} locations after normalization. Include more surrounding context to make the match unique.`;
      }

      // Single fuzzy match — find position in normalized content, map back to original
      const normalizedIdx = normalizedContent.indexOf(normalizedOld);

      // Walk through original content to find the corresponding range
      // Since normalization is char-by-char replacement (same length), indices map directly
      const originalOld = content.slice(normalizedIdx, normalizedIdx + normalizedOld.length);
      const idx = content.indexOf(originalOld);

      if (idx === -1) {
        // Fallback: shouldn't happen, but be safe
        return `Error: Could not map fuzzy match back to original content. Try providing the exact text from the file.`;
      }

      const updated = content.slice(0, idx) + new_string + content.slice(idx + originalOld.length);
      await fs.writeFile(file_path, updated, 'utf-8');
      const diff = generateDiff(file_path, content, updated, idx, originalOld, new_string);
      return `Successfully edited ${file_path} (fuzzy match)\n\n${diff}`;
    },
    {
      name: 'edit_file',
      description: 'Edit a file by finding and replacing text. The old_string must match exactly one location in the file. Supports fuzzy matching for Unicode quote/dash/whitespace differences. Returns a diff of the change.',
      schema: EditFileSchema,
    }
  );
}
