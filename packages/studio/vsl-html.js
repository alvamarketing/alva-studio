const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'template', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext']);
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function tagNameFromOpening(source, start) {
  const match = source.slice(start).match(/^<([A-Za-z][\w:-]*)\b/);
  return match?.[1] || '';
}

function findTagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

function parseOpeningTag(source, start, end) {
  const raw = source.slice(start, end + 1);
  const tagName = tagNameFromOpening(source, start);
  if (!tagName) return null;
  const nameEnd = start + 1 + tagName.length;
  const attributes = [];
  let index = nameEnd;
  while (index < end) {
    while (index < end && /\s/.test(source[index])) index += 1;
    if (index >= end) break;
    if (source[index] === '/') {
      index += 1;
      while (index < end && /\s/.test(source[index])) index += 1;
      if (index !== end) return null;
      break;
    }
    const nameStart = index;
    while (index < end && !/[\s=/>]/.test(source[index])) index += 1;
    if (index === nameStart) return null;
    const name = source.slice(nameStart, index).toLowerCase();
    if (!/^[a-z_:][a-z0-9:._-]*$/i.test(name)) return null;
    while (index < end && /\s/.test(source[index])) index += 1;
    let value = null;
    if (source[index] === '=') {
      index += 1;
      while (index < end && /\s/.test(source[index])) index += 1;
      if (index >= end) return null;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < end && source[index] !== quote) index += 1;
        if (index >= end) return null;
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < end && !/[\s>]/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
        if (/["'`=<>]/.test(value)) return null;
      }
    }
    attributes.push({ name, value });
  }
  return { raw, tagName: tagName.toLowerCase(), attributes, selfClosing: /\/\s*>$/.test(raw) };
}

function findRawTextEnd(source, contentStart, tagName) {
  const closing = new RegExp(`</${tagName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*>`, 'ig');
  closing.lastIndex = contentStart;
  const match = closing.exec(source);
  return match ? match.index + match[0].length : -1;
}

function findCdataEnd(source, start) {
  const end = source.indexOf(']]>', start);
  return end < 0 ? -1 : end + 3;
}

function isDoctype(source, start, end) {
  return /^<!doctype\b[^>]*>$/i.test(source.slice(start, end + 1));
}

function validateHtmlDocument(source) {
  const stack = [];
  let index = 0;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return stack.length === 0;
    if (source.startsWith('<!--', nextTag)) {
      const commentEnd = source.indexOf('-->', nextTag + 4);
      if (commentEnd < 0) return false;
      index = commentEnd + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', nextTag)) {
      const cdataEnd = findCdataEnd(source, nextTag + 9);
      if (cdataEnd < 0) return false;
      index = cdataEnd;
      continue;
    }
    const tagEnd = findTagEnd(source, nextTag);
    if (tagEnd < 0) return false;
    if (isDoctype(source, nextTag, tagEnd)) {
      index = tagEnd + 1;
      continue;
    }
    if (source[nextTag + 1] === '/') {
      const closing = source.slice(nextTag, tagEnd + 1).match(/^<\/([A-Za-z][\w:-]*)\s*>$/);
      if (!closing) return false;
      const tagName = closing[1].toLowerCase();
      if (VOID_ELEMENTS.has(tagName) || stack.pop() !== tagName) return false;
      index = tagEnd + 1;
      continue;
    }
    const opening = parseOpeningTag(source, nextTag, tagEnd);
    if (!opening) return false;
    if (RAW_TEXT_ELEMENTS.has(opening.tagName)) {
      if (opening.selfClosing) return false;
      if (opening.tagName === 'plaintext') return true;
      const rawEnd = findRawTextEnd(source, tagEnd + 1, opening.tagName);
      if (rawEnd < 0) return false;
      index = rawEnd;
      continue;
    }
    if (opening.selfClosing && !VOID_ELEMENTS.has(opening.tagName)) return false;
    if (!opening.selfClosing && !VOID_ELEMENTS.has(opening.tagName)) stack.push(opening.tagName);
    index = tagEnd + 1;
  }
  return stack.length === 0;
}

function findElementEnd(source, contentStart, tagName) {
  let depth = 1;
  let index = contentStart;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return -1;
    if (source.startsWith('<!--', nextTag)) {
      const commentEnd = source.indexOf('-->', nextTag + 4);
      if (commentEnd < 0) return -1;
      index = commentEnd + 3;
      continue;
    }
    const closingMatch = source.slice(nextTag).match(new RegExp(`^</\\s*${tagName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*>`, 'i'));
    if (closingMatch) {
      depth -= 1;
      index = nextTag + closingMatch[0].length;
      if (!depth) return index;
      continue;
    }
    const candidateName = tagNameFromOpening(source, nextTag);
    if (!candidateName) {
      index = nextTag + 1;
      continue;
    }
    const tagEnd = findTagEnd(source, nextTag);
    if (tagEnd < 0) return -1;
    const candidate = parseOpeningTag(source, nextTag, tagEnd);
    if (!candidate) return -1;
    if (RAW_TEXT_ELEMENTS.has(candidate.tagName)) {
      const rawEnd = findRawTextEnd(source, tagEnd + 1, candidate.tagName);
      if (rawEnd < 0) return -1;
      index = rawEnd;
      continue;
    }
    if (candidate.tagName === tagName && !candidate.selfClosing) depth += 1;
    index = tagEnd + 1;
  }
  return -1;
}

export function transformHtmlElements(sourceValue, replaceElement) {
  const source = String(sourceValue ?? '');
  if (!validateHtmlDocument(source)) return source;
  let output = '';
  let index = 0;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return output + source.slice(index);
    output += source.slice(index, nextTag);
    if (source.startsWith('<!--', nextTag)) {
      const commentEnd = source.indexOf('-->', nextTag + 4);
      if (commentEnd < 0) return output + source.slice(nextTag);
      output += source.slice(nextTag, commentEnd + 3);
      index = commentEnd + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', nextTag)) {
      const cdataEnd = findCdataEnd(source, nextTag + 9);
      if (cdataEnd < 0) return source;
      output += source.slice(nextTag, cdataEnd);
      index = cdataEnd;
      continue;
    }
    const tagName = tagNameFromOpening(source, nextTag);
    if (!tagName) {
      output += '<';
      index = nextTag + 1;
      continue;
    }
    const tagEnd = findTagEnd(source, nextTag);
    if (tagEnd < 0) return output + source.slice(nextTag);
    const opening = parseOpeningTag(source, nextTag, tagEnd);
    if (!opening) return output + source.slice(nextTag);
    if (RAW_TEXT_ELEMENTS.has(opening.tagName)) {
      const rawEnd = findRawTextEnd(source, tagEnd + 1, opening.tagName);
      if (rawEnd < 0) return output + source.slice(nextTag);
      output += source.slice(nextTag, rawEnd);
      index = rawEnd;
      continue;
    }
    const replacement = replaceElement({ ...opening, start: nextTag, end: tagEnd });
    if (replacement !== undefined && replacement !== null) {
      const elementEnd = opening.selfClosing ? tagEnd + 1 : findElementEnd(source, tagEnd + 1, opening.tagName);
      if (elementEnd < 0) return output + source.slice(nextTag);
      output += String(replacement);
      index = elementEnd;
      continue;
    }
    output += source.slice(nextTag, tagEnd + 1);
    index = tagEnd + 1;
  }
  return output;
}
