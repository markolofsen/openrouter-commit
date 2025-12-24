/**
 * Text formatting and block wrapping utilities
 */

/**
 * Clean text by removing extra whitespace and line breaks
 */
export function cleanText(text: string): string {
  return text
    .trim()                           // Remove leading/trailing whitespace
    .replace(/\r\n/g, '\n')          // Normalize line endings first
    .replace(/  +/g, ' ')            // Replace multiple spaces with single space
    .replace(/ +\n/g, '\n')          // Remove trailing spaces before newlines
    .replace(/\n{3,}/g, '\n\n');     // Replace 3+ newlines with double newline
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
 * Wrap git context (history + branch) in GIT_CONTEXT block
 */
export function wrapGitContext(gitContext: string): string {
  return wrapInBlock('GIT_CONTEXT', gitContext, false); // Don't clean git context
}

/**
 * Extract balanced JSON object from string
 * Handles nested braces correctly
 */
function extractBalancedJson(text: string): string | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Parse AI JSON response with fallback to plain text
 * Handles various response formats: pure JSON, markdown-wrapped, or plain text
 * @param response - AI response (should be JSON)
 * @returns Object with assessment and commitMessage
 */
export function parseAIResponse(response: string): {
  assessment: string | null;
  commitMessage: string;
} {
  const originalResponse = response.trim();

  // Strategy 1: Try to find JSON in markdown code block (```json ... ```)
  // Use balanced extraction for nested JSON
  const codeBlockMatch = originalResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const jsonContent = extractBalancedJson(codeBlockMatch[1]);
    if (jsonContent) {
      try {
        const parsed = JSON.parse(jsonContent);
        if (parsed && typeof parsed === 'object' && parsed.commitMessage) {
          return {
            assessment: parsed.codeAssessment || null,
            commitMessage: parsed.commitMessage
          };
        }
      } catch {
        // Continue to next strategy
      }
    }
  }

  // Strategy 2: Try to extract JSON directly from anywhere in the response
  const jsonFromResponse = extractBalancedJson(originalResponse);
  if (jsonFromResponse) {
    try {
      const parsed = JSON.parse(jsonFromResponse);
      if (parsed && typeof parsed === 'object' && parsed.commitMessage) {
        return {
          assessment: parsed.codeAssessment || null,
          commitMessage: parsed.commitMessage
        };
      }
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Remove common prefixes and try again
  let cleanResponse = originalResponse
    .replace(/^(?:Here is|Here's|This is|The|A)\s+(?:a\s+)?(?:professional[,.]?\s*)?(?:comprehensive\s+)?(?:the\s+)?(?:commit\s+message|JSON|response|result)[^:]*:?\s*/i, '')
    .trim();

  // Try to parse cleaned response as JSON
  const jsonFromClean = extractBalancedJson(cleanResponse);
  if (jsonFromClean) {
    try {
      const parsed = JSON.parse(jsonFromClean);
      if (parsed && typeof parsed === 'object' && parsed.commitMessage) {
        return {
          assessment: parsed.codeAssessment || null,
          commitMessage: parsed.commitMessage
        };
      }
    } catch {
      // Continue to fallback
    }
  }

  // Strategy 4: Try direct JSON parse of clean response
  try {
    const parsed = JSON.parse(cleanResponse);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        assessment: parsed.codeAssessment || null,
        commitMessage: parsed.commitMessage || originalResponse
      };
    }
  } catch {
    // Continue to fallback
  }

  // Fallback: treat entire response as commit message (backward compatibility)
  return {
    assessment: null,
    commitMessage: originalResponse
  };
}
