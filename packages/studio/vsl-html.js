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

function tokenizeHtmlDocument(source) {
  const stack = [];
  const elements = new Map();
  const protectedRanges = new Map();
  let index = 0;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return stack.length === 0 ? { elements, protectedRanges } : null;
    if (source.startsWith('<!--', nextTag)) {
      const commentEnd = source.indexOf('-->', nextTag + 4);
      if (commentEnd < 0) return null;
      protectedRanges.set(nextTag, commentEnd + 3);
      index = commentEnd + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', nextTag)) {
      const cdataEnd = findCdataEnd(source, nextTag + 9);
      if (cdataEnd < 0) return null;
      protectedRanges.set(nextTag, cdataEnd);
      index = cdataEnd;
      continue;
    }
    const tagEnd = findTagEnd(source, nextTag);
    if (tagEnd < 0) return null;
    if (isDoctype(source, nextTag, tagEnd)) {
      index = tagEnd + 1;
      continue;
    }
    if (source[nextTag + 1] === '/') {
      const closing = source.slice(nextTag, tagEnd + 1).match(/^<\/([A-Za-z][\w:-]*)\s*>$/);
      if (!closing) return null;
      const tagName = closing[1].toLowerCase();
      const context = stack[stack.length - 1];
      if (VOID_ELEMENTS.has(tagName) || !context || context.tagName !== tagName) return null;
      context.element.elementEnd = tagEnd + 1;
      stack.pop();
      index = tagEnd + 1;
      continue;
    }
    const opening = parseOpeningTag(source, nextTag, tagEnd);
    if (!opening) return null;
    if (RAW_TEXT_ELEMENTS.has(opening.tagName)) {
      if (opening.selfClosing || opening.tagName === 'plaintext') return null;
      const rawEnd = findRawTextEnd(source, tagEnd + 1, opening.tagName);
      if (rawEnd < 0) return null;
      protectedRanges.set(nextTag, rawEnd);
      index = rawEnd;
      continue;
    }
    if (opening.selfClosing && !VOID_ELEMENTS.has(opening.tagName)) return null;
    const element = { ...opening, start: nextTag, openEnd: tagEnd + 1, elementEnd: opening.selfClosing ? tagEnd + 1 : null };
    elements.set(nextTag, element);
    if (!opening.selfClosing && !VOID_ELEMENTS.has(opening.tagName)) stack.push({ tagName: opening.tagName, element });
    index = tagEnd + 1;
  }
  return stack.length === 0 ? { elements, protectedRanges } : null;
}

export function transformHtmlElements(sourceValue, replaceElement) {
  const source = String(sourceValue ?? '');
  const tokenized = tokenizeHtmlDocument(source);
  if (!tokenized) return source;
  const { elements, protectedRanges } = tokenized;
  let output = '';
  let index = 0;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return output + source.slice(index);
    output += source.slice(index, nextTag);
    const protectedEnd = protectedRanges.get(nextTag);
    if (protectedEnd !== undefined) {
      output += source.slice(nextTag, protectedEnd);
      index = protectedEnd;
      continue;
    }
    const opening = elements.get(nextTag);
    if (!opening) {
      output += '<';
      index = nextTag + 1;
      continue;
    }
    const replacement = replaceElement({ ...opening, end: opening.openEnd - 1 });
    if (replacement !== undefined && replacement !== null) {
      output += String(replacement);
      index = opening.elementEnd;
      continue;
    }
    output += source.slice(nextTag, opening.openEnd);
    index = opening.openEnd;
  }
  return output;
}
