/**
 * Coupang Category Parser
 * 
 * Parses breadcrumb HTML to extract category path information.
 */

/**
 * Parse breadcrumb HTML to extract category path
 * @param {string} breadcrumbHtml - HTML string of breadcrumb element
 * @returns {object|null} - Parsed category info or null if invalid
 */
function parseBreadcrumb(breadcrumbHtml) {
  if (!breadcrumbHtml || typeof breadcrumbHtml !== 'string') {
    return null;
  }
  
  try {
    // Extract text from <a> tags using regex (Node.js doesn't have DOM)
    const linkRegex = /<a[^>]*>([^<]+)<\/a>/gi;
    const segments = [];
    let match;
    
    while ((match = linkRegex.exec(breadcrumbHtml)) !== null) {
      const text = match[1].trim();
      if (text && text !== '쿠팡 홈' && text !== 'Coupang Home') {
        segments.push(text);
      }
    }
    
    // Also try extracting from plain text (fallback)
    if (segments.length === 0) {
      const plainText = breadcrumbHtml
        .replace(/<[^>]+>/g, '|')  // Replace tags with separator
        .split('|')
        .map(s => s.trim())
        .filter(s => s && s !== '쿠팡 홈' && s !== 'Coupang Home' && s !== '>');
      
      segments.push(...plainText);
    }
    
    if (segments.length === 0) {
      return null;
    }
    
    // Build paths
    const fullPath = segments.join(' > ');
    
    // depth3Path: last 3 segments
    const depth3Segments = segments.slice(-3);
    const depth3Path = depth3Segments.join(' > ');
    
    // depth2Path: last 2 segments
    const depth2Segments = segments.slice(-2);
    const depth2Path = depth2Segments.join(' > ');
    
    // Derived names from depth3Path
    const rootName = depth3Segments[0] || '';
    const parentName = depth3Segments.length >= 2 ? depth3Segments[depth3Segments.length - 2] : '';
    const leafName = depth3Segments[depth3Segments.length - 1] || '';
    
    return {
      fullPath,
      depth2Path,
      depth3Path,
      rootName,
      parentName,
      leafName
    };
    
  } catch (err) {
    console.error('Breadcrumb parse error:', err.message);
    return null;
  }
}

/**
 * Parse breadcrumb from text format (segments already extracted)
 * @param {string[]} segments - Array of category segments (excluding "쿠팡 홈")
 * @returns {object|null} - Parsed category info
 */
function parseBreadcrumbSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return null;
  }
  
  // Filter out empty and home segments
  const filtered = segments.filter(s => 
    s && s.trim() && s !== '쿠팡 홈' && s !== 'Coupang Home'
  );
  
  if (filtered.length === 0) {
    return null;
  }
  
  const fullPath = filtered.join(' > ');
  
  // depth3Path: last 3 segments
  const depth3Segments = filtered.slice(-3);
  const depth3Path = depth3Segments.join(' > ');
  
  // depth2Path: last 2 segments
  const depth2Segments = filtered.slice(-2);
  const depth2Path = depth2Segments.join(' > ');
  
  // Derived names
  const rootName = depth3Segments[0] || '';
  const parentName = depth3Segments.length >= 2 ? depth3Segments[depth3Segments.length - 2] : '';
  const leafName = depth3Segments[depth3Segments.length - 1] || '';
  
  return {
    fullPath,
    depth2Path,
    depth3Path,
    rootName,
    parentName,
    leafName
  };
}

module.exports = {
  parseBreadcrumb,
  parseBreadcrumbSegments
};
