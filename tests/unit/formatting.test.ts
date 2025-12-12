/**
 * Tests for text formatting utilities
 */

import {
  cleanText,
  wrapInBlock,
  createStructuredPrompt,
  wrapUserFeedback,
  wrapDiffContent,
  wrapInstructions,
  wrapRules,
  wrapContext,
  wrapExamples,
  parseAIResponse,
} from '../../src/utils/formatting.js';

describe('Formatting Utilities', () => {
  describe('cleanText', () => {
    it('should trim leading and trailing whitespace', () => {
      const text = '  hello world  ';
      const result = cleanText(text);
      expect(result).toBe('hello world');
    });

    it('should replace multiple spaces with single space', () => {
      const text = 'hello    world';
      const result = cleanText(text);
      expect(result).toBe('hello world');
    });

    it('should replace 3+ newlines with double newlines', () => {
      const text = 'line1\n\n\n\nline2';
      const result = cleanText(text);
      expect(result).toBe('line1\n\nline2');
    });

    it('should normalize Windows line endings', () => {
      const text = 'line1\r\nline2\r\nline3';
      const result = cleanText(text);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should handle complex text with all formatting issues', () => {
      const text = '  hello    world\n\n\n\nfoo  bar  \r\n\r\nbaz  ';
      const result = cleanText(text);
      expect(result).toBe('hello world\n\nfoo bar\n\nbaz');
    });

    it('should preserve single newlines', () => {
      const text = 'line1\nline2\nline3';
      const result = cleanText(text);
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should preserve double newlines', () => {
      const text = 'paragraph1\n\nparagraph2';
      const result = cleanText(text);
      expect(result).toBe('paragraph1\n\nparagraph2');
    });
  });

  describe('wrapInBlock', () => {
    it('should wrap text in a named block', () => {
      const text = 'content here';
      const result = wrapInBlock('TEST', text);
      expect(result).toBe('[TEST]\ncontent here\n[/TEST]');
    });

    it('should clean text by default', () => {
      const text = '  content   with   spaces  ';
      const result = wrapInBlock('TEST', text);
      expect(result).toBe('[TEST]\ncontent with spaces\n[/TEST]');
    });

    it('should not clean text when cleanContent is false', () => {
      const text = '  content   with   spaces  ';
      const result = wrapInBlock('TEST', text, false);
      expect(result).toBe('[TEST]\n  content   with   spaces  \n[/TEST]');
    });

    it('should handle multi-line content', () => {
      const text = 'line1\nline2\nline3';
      const result = wrapInBlock('MULTILINE', text);
      expect(result).toBe('[MULTILINE]\nline1\nline2\nline3\n[/MULTILINE]');
    });
  });

  describe('createStructuredPrompt', () => {
    it('should create prompt with multiple blocks', () => {
      const blocks = [
        { name: 'INSTRUCTIONS', content: 'Do this' },
        { name: 'RULES', content: 'Follow these' },
        { name: 'CONTEXT', content: 'Extra info' },
      ];
      const result = createStructuredPrompt(blocks);

      expect(result).toContain('[INSTRUCTIONS]\nDo this\n[/INSTRUCTIONS]');
      expect(result).toContain('[RULES]\nFollow these\n[/RULES]');
      expect(result).toContain('[CONTEXT]\nExtra info\n[/CONTEXT]');
    });

    it('should join blocks with double newlines', () => {
      const blocks = [
        { name: 'BLOCK1', content: 'content1' },
        { name: 'BLOCK2', content: 'content2' },
      ];
      const result = createStructuredPrompt(blocks);

      expect(result).toBe('[BLOCK1]\ncontent1\n[/BLOCK1]\n\n[BLOCK2]\ncontent2\n[/BLOCK2]');
    });

    it('should respect clean parameter per block', () => {
      const blocks = [
        { name: 'CLEAN', content: '  text  with  spaces  ', clean: true },
        { name: 'RAW', content: '  text  with  spaces  ', clean: false },
      ];
      const result = createStructuredPrompt(blocks);

      expect(result).toContain('[CLEAN]\ntext with spaces\n[/CLEAN]');
      expect(result).toContain('[RAW]\n  text  with  spaces  \n[/RAW]');
    });
  });

  describe('Helper wrappers', () => {
    it('wrapUserFeedback should use IMPORTANT_USER_FEEDBACK block', () => {
      const result = wrapUserFeedback('Be more specific');
      expect(result).toContain('[IMPORTANT_USER_FEEDBACK]');
      expect(result).toContain('Be more specific');
      expect(result).toContain('[/IMPORTANT_USER_FEEDBACK]');
    });

    it('wrapDiffContent should use DIFF_CONTENT block and not clean', () => {
      const diff = '  +added line  \n  -removed line  ';
      const result = wrapDiffContent(diff);
      expect(result).toContain('[DIFF_CONTENT]');
      expect(result).toContain('  +added line  '); // Spaces preserved
      expect(result).toContain('[/DIFF_CONTENT]');
    });

    it('wrapInstructions should use INSTRUCTIONS block', () => {
      const result = wrapInstructions('Follow these steps');
      expect(result).toContain('[INSTRUCTIONS]');
      expect(result).toContain('Follow these steps');
      expect(result).toContain('[/INSTRUCTIONS]');
    });

    it('wrapRules should use RULES block', () => {
      const result = wrapRules('Rule 1\nRule 2');
      expect(result).toContain('[RULES]');
      expect(result).toContain('Rule 1');
      expect(result).toContain('[/RULES]');
    });

    it('wrapContext should use CONTEXT block', () => {
      const result = wrapContext('Additional context');
      expect(result).toContain('[CONTEXT]');
      expect(result).toContain('Additional context');
      expect(result).toContain('[/CONTEXT]');
    });

    it('wrapExamples should use EXAMPLES block', () => {
      const result = wrapExamples('Example 1\nExample 2');
      expect(result).toContain('[EXAMPLES]');
      expect(result).toContain('Example 1');
      expect(result).toContain('[/EXAMPLES]');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      const result = cleanText('');
      expect(result).toBe('');
    });

    it('should handle only whitespace', () => {
      const result = cleanText('   \n\n\n   ');
      expect(result).toBe('');
    });

    it('should handle very long text', () => {
      const longText = 'word '.repeat(10000);
      const result = cleanText(longText);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('  '); // No double spaces
    });

    it('should handle special characters in block names', () => {
      const result = wrapInBlock('SPECIAL_BLOCK-123', 'content');
      expect(result).toContain('[SPECIAL_BLOCK-123]');
      expect(result).toContain('[/SPECIAL_BLOCK-123]');
    });
  });

  describe('parseAIResponse', () => {
    it('should parse valid JSON response with both fields', () => {
      const response = JSON.stringify({
        codeAssessment: 'Sarcastic comment here',
        commitMessage: 'feat: add new feature'
      });
      const result = parseAIResponse(response);

      expect(result.assessment).toBe('Sarcastic comment here');
      expect(result.commitMessage).toBe('feat: add new feature');
    });

    it('should handle JSON response with missing codeAssessment', () => {
      const response = JSON.stringify({
        commitMessage: 'fix: bug fix'
      });
      const result = parseAIResponse(response);

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('fix: bug fix');
    });

    it('should handle JSON response with missing commitMessage', () => {
      const response = JSON.stringify({
        codeAssessment: 'Code review here'
      });
      const result = parseAIResponse(response);

      expect(result.assessment).toBe('Code review here');
      expect(result.commitMessage).toBe(response); // Fallback to full response
    });

    it('should fallback to plain text for invalid JSON', () => {
      const response = 'This is not JSON, just plain commit message';
      const result = parseAIResponse(response);

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('This is not JSON, just plain commit message');
    });

    it('should handle JSON response with extra whitespace', () => {
      const response = `
        {
          "codeAssessment": "Witty remark",
          "commitMessage": "chore: update dependencies"
        }
      `;
      const result = parseAIResponse(response);

      expect(result.assessment).toBe('Witty remark');
      expect(result.commitMessage).toBe('chore: update dependencies');
    });

    it('should handle empty string', () => {
      const result = parseAIResponse('');

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('');
    });

    it('should handle malformed JSON gracefully', () => {
      const response = '{ invalid json }';
      const result = parseAIResponse(response);

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('{ invalid json }');
    });

    it('should handle non-object JSON (array)', () => {
      const response = '["item1", "item2"]';
      const result = parseAIResponse(response);

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('["item1", "item2"]');
    });

    it('should handle non-object JSON (string)', () => {
      const response = '"just a string"';
      const result = parseAIResponse(response);

      expect(result.assessment).toBeNull();
      expect(result.commitMessage).toBe('"just a string"');
    });
  });
});
