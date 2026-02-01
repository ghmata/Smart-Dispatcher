const SpintaxParser = require('./spintax');

function normalizeVariables(variables = {}) {
  return Object.entries(variables).reduce((acc, [key, value]) => {
    if (!key) return acc;
    acc[String(key).trim().toLowerCase()] = value == null ? '' : String(value);
    return acc;
  }, {});
}

function applyTemplate(template, variables) {
  if (!template) return '';
  const normalized = normalizeVariables(variables);

  // Regex to match {var} OR [var]
  // We exclude | and / inside {} to avoid matching Spintax as variables
  const withVariables = template.replace(/\{([^{}|/]+)\}|\[([^\[\]]+)\]/g, (match, rawKeyBraces, rawKeyBrackets) => {
    const rawKey = rawKeyBraces || rawKeyBrackets;
    const key = String(rawKey).trim().toLowerCase();
    
    // Check if key exists in normalized variables
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      return normalized[key];
    }
    // If not found, return original match (leave placeholders or spintax alone)
    return match;
  });

  return SpintaxParser.parse(withVariables);
}

module.exports = {
  applyTemplate
};
