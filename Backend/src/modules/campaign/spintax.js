/**
 * SpintaxParser
 * Handles variations like "{Hello|Hi|Hey}" to generate unique messages.
 */
class SpintaxParser {
  /**
   * Resolves a Spintax string into a single variation.
   * @param {string} text - The text containing Spintax patterns.
   * @returns {string} - The resolved text.
   */
  static parse(text) {
    if (!text) return '';
    
    // Recursive regex to handle nested Spintax: {A|{B|C}}
    const spinRegex = /\{([^{}]+)\}/;
    
    let processed = text;
    while (spinRegex.test(processed)) {
      processed = processed.replace(spinRegex, (match, content) => {
        const options = content.split('/');
        const randomOption = options[Math.floor(Math.random() * options.length)];
        return randomOption;
      });
    }
    
    return processed;
  }
}

module.exports = SpintaxParser;
