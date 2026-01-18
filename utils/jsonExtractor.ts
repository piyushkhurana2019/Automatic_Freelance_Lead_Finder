export const extractJsonFromResponse = async (
    response: string,
  ): Promise<Record<string, any> | null> => {
    try {
  
      // Method 1: Try simple first and last index approach
      const trySimpleExtraction = (str: string): Record<string, any> | null => {
        const curlyStartIdx = str.indexOf('{');
        const squareStartIdx = str.indexOf('[');
  
        let startIdx: number;
        let endChar: string;
  
        // Determine which bracket appears first
        if (curlyStartIdx === -1 && squareStartIdx === -1) {
          return null;
        }
  
        if (
          curlyStartIdx === -1 ||
          (squareStartIdx !== -1 && squareStartIdx < curlyStartIdx)
        ) {
          startIdx = squareStartIdx;
          endChar = ']';
        } else {
          startIdx = curlyStartIdx;
          endChar = '}';
        }
  
        const endIdx = str.lastIndexOf(endChar) + 1;
  
        if (endIdx <= 0) {
          return null;
        }
  
        try {
          const jsonStr = str.slice(startIdx, endIdx);
          const result = JSON.parse(jsonStr);
  
          // Handle double-encoded JSON strings
          if (typeof result === 'object' && result !== null) {
            // Check for string values that might be JSON
            for (const [key, value] of Object.entries(result)) {
              if (
                typeof value === 'string' &&
                (value.startsWith('{') || value.startsWith('['))
              ) {
                try {
                  result[key] = JSON.parse(value);
                } catch (e) {
                  // If parsing fails, keep the original string value
                  console.log(
                    `Failed to parse nested JSON for key ${key}, keeping original value`,
                  );
                }
              }
            }
          }
  
          // Validate that we got a valid object/array
          if (typeof result === 'object' && result !== null) {
            return result;
          }
          return null;
        } catch (e) {
          console.log('Simple extraction failed, will try fallback method');
          return null;
        }
      };
  
      // Method 2: Fallback - Find matching brackets with better nesting handling
      const tryFallbackExtraction = (str: string): Record<string, any> | null => {
        const curlyStartIdx = str.indexOf('{');
        const squareStartIdx = str.indexOf('[');
  
        // Try both types of brackets
        const attempts: { start: number, char: string, endChar: string }[] = [];
  
        if (curlyStartIdx !== -1) {
          attempts.push({ start: curlyStartIdx, char: '{', endChar: '}' });
        }
        if (squareStartIdx !== -1) {
          attempts.push({ start: squareStartIdx, char: '[', endChar: ']' });
        }
  
        // Sort by which appears first
        attempts.sort((a, b) => a.start - b.start);
  
        for (const { start, char, endChar } of attempts) {
          let count = 0;
          let inString = false;
          let escapeNext = false;
  
          for (let i = start; i < str.length; i++) {
            const currentChar = str[i];
  
            // Handle string literals
            if (currentChar === '"' && !escapeNext) {
              inString = !inString;
            }
            escapeNext = currentChar === '\\' && !escapeNext;
  
            // Only count brackets when not in a string
            if (!inString) {
              if (currentChar === char) count++;
              if (currentChar === endChar) count--;
  
              if (count === 0) {
                try {
                  const jsonStr = str.slice(start, i + 1);
                  const result = JSON.parse(jsonStr);
  
                  // Handle double-encoded JSON strings
                  if (typeof result === 'object' && result !== null) {
                    // Check for string values that might be JSON
                    for (const [key, value] of Object.entries(result)) {
                      if (
                        typeof value === 'string' &&
                        (value.startsWith('{') || value.startsWith('['))
                      ) {
                        try {
                          result[key] = JSON.parse(value);
                        } catch (e) {
                          // If parsing fails, keep the original string value
                          console.log(
                            `Failed to parse nested JSON for key ${key}, keeping original value`,
                          );
                        }
                      }
                    }
                  }
  
                  // Validate that we got a valid object/array
                  if (typeof result === 'object' && result !== null) {
                    return result;
                  }
                } catch (e) {
                  continue; // Try next attempt if this fails
                }
              }
            }
          }
        }
  
        return null;
      };
  
      // Try Method 1 first
      const simpleResult = trySimpleExtraction(response);
      if (simpleResult) {
        console.log('Successfully extracted JSON using simple method');
        return simpleResult;
      }
  
      // If Method 1 fails, try Method 2
      const fallbackResult = tryFallbackExtraction(response);
      if (fallbackResult) {
        console.log('Successfully extracted JSON using fallback method');
        return fallbackResult;
      }
  
      // If both methods fail, try to clean the response and try again
      const cleanedResponse = response
        .replace(/[\n\r\t]/g, '') // Remove newlines and tabs
        .replace(/\s+/g, ' '); // Normalize whitespace
  
      const cleanedResult =
        trySimpleExtraction(cleanedResponse) ||
        tryFallbackExtraction(cleanedResponse);
  
      if (cleanedResult) {
        return cleanedResult;
      }
      
      console.log('Failed to extract valid JSON using all methods');
      console.log('Raw response before conversion:', response);
      return null;
    } catch (error) {
      console.error('Error extracting JSON:', error);
    return null;
  }
}
