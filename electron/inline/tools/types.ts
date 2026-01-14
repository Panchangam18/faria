import { TextEdit } from '../../services/text-extraction';

export interface InlineResult {
  type: 'answer' | 'edits' | 'image' | 'error';
  content: string;
  edits?: TextEdit[];
  imageUrl?: string;
}

export interface ToolExecutionResult {
  output: string;
  terminal: boolean;
  result: InlineResult;
}

