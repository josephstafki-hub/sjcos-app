import { parseDocument, DomUtils } from 'htmlparser2';

/** Normalize before sanitizing: Gmail's class/id markers otherwise disappear.
 * Keep attribution and history in one fold, including Outlook's following siblings. */
export function foldEmailQuotes(html: string): string {
  const doc = parseDocument(html);
  const nodes = DomUtils.findAll(e => e.name === 'blockquote' || /(?:^|\s)gmail_(?:quote|attr)(?:\s|$)/.test(e.attribs.class ?? '') || e.attribs.id === 'divRplyFwdMsg', doc.children);
  for (const node of nodes) {
    const outlook = node.attribs.id === 'divRplyFwdMsg';
    node.name = 'blockquote';
    // Outlook's separator starts the old message, which runs to the end of the
    // containing div and sometimes continues outside that div.
    if (outlook) {
      let boundary = node;
      while (boundary.parent && boundary.parent.type !== 'root') {
        while (boundary.next) DomUtils.appendChild(node, boundary.next);
        boundary = boundary.parent as typeof node;
      }
      while (boundary.next) DomUtils.appendChild(node, boundary.next);
    }
    let before = node.prev;
    while (before && (before.type === 'text' && !before.data.trim() || before.type === 'tag' && before.name === 'br')) before = before.prev;
    if (before?.type === 'tag' && /^On\s+[\s\S]{4,1000}?wrote:\s*$/i.test(DomUtils.innerText(before).trim())) {
      DomUtils.prependChild(node, before);
    }
  }
  return DomUtils.getOuterHTML(doc);
}

