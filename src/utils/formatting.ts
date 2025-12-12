/**
 * Text formatting and block wrapping utilities
 */

/**
 * Clean text by removing extra whitespace and line breaks
 */
export function cleanText(text: string): string {
  return text
    .trim()                           // Remove leading/trailing whitespace
    .replace(/  +/g, ' ')            // Replace multiple spaces with single space
    .replace(/\n{3,}/g, '\n\n')      // Replace 3+ newlines with double newline
    .replace(/\r\n/g, '\n');         // Normalize line endings
}

/**
 * Wrap text in a named block
 * @param blockName - Name of the block (e.g., 'IMPORTANT', 'CONTEXT', 'DIFF')
 * @param content - Content to wrap
 * @param cleanContent - Whether to clean the content first (default: true)
 */
export function wrapInBlock(
  blockName: string,
  content: string,
  cleanContent: boolean = true
): string {
  const processedContent = cleanContent ? cleanText(content) : content;
  return `[${blockName}]\n${processedContent}\n[/${blockName}]`;
}

/**
 * Create structured prompt with multiple blocks
 * @param blocks - Array of {name, content, clean} objects
 */
export function createStructuredPrompt(
  blocks: Array<{ name: string; content: string; clean?: boolean }>
): string {
  return blocks
    .map(block => wrapInBlock(block.name, block.content, block.clean ?? true))
    .join('\n\n');
}

/**
 * Wrap user feedback in IMPORTANT block
 */
export function wrapUserFeedback(feedback: string): string {
  return wrapInBlock('IMPORTANT_USER_FEEDBACK', feedback);
}

/**
 * Wrap diff content in DIFF_CONTENT block
 */
export function wrapDiffContent(diff: string): string {
  return wrapInBlock('DIFF_CONTENT', diff, false); // Don't clean diff content
}

/**
 * Wrap instructions in INSTRUCTIONS block
 */
export function wrapInstructions(instructions: string): string {
  return wrapInBlock('INSTRUCTIONS', instructions);
}

/**
 * Wrap examples in EXAMPLES block
 */
export function wrapExamples(examples: string): string {
  return wrapInBlock('EXAMPLES', examples);
}

/**
 * Wrap context in CONTEXT block
 */
export function wrapContext(context: string): string {
  return wrapInBlock('CONTEXT', context);
}

/**
 * Wrap rules in RULES block
 */
export function wrapRules(rules: string): string {
  return wrapInBlock('RULES', rules);
}

/**
 * Parse AI JSON response with fallback to plain text
 * @param response - AI response (should be JSON)
 * @returns Object with assessment and commitMessage
 */
export function parseAIResponse(response: string): {
  assessment: string | null;
  commitMessage: string;
} {
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(response.trim());

    if (parsed && typeof parsed === 'object') {
      return {
        assessment: parsed.codeAssessment || null,
        commitMessage: parsed.commitMessage || response.trim()
      };
    }
  } catch (error) {
    // JSON parsing failed - fallback to plain text
  }

  // Fallback: treat entire response as commit message (backward compatibility)
  return {
    assessment: null,
    commitMessage: response.trim()
  };
}
