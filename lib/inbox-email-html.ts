import { parseDocument, DomUtils } from 'htmlparser2';
import { Text, isTag } from 'domhandler';

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
    // iOS/Gmail mobile places attribution text + a mailto link in the same
    // div as the signature. Move just the trailing line, never the whole div.
    const siblings = [];
    for (let p = node.prev; p; p = p.prev) siblings.unshift(p);
    const pieces = siblings.map(p => p.type === 'tag' && p.name === 'br' ? '\n' : (p.type === 'tag' && /^(?:div|p)$/.test(p.name) ? '\n' : '') + DomUtils.textContent(p));
    const beforeText = pieces.join('');
    const match = /(?:^|\n)[ \t\u00a0]*On[ \t\u00a0]+[\s\S]{4,1000}?wrote:[\s\u00a0]*$/i.exec(beforeText);
    if (match) {
      const start = match.index + match[0].indexOf('On');
      let offset = 0;
      for (let i = 0; i < siblings.length; i++) {
        const part = siblings[i];
        if (offset + pieces[i].length > start) {
          let moving = siblings.slice(i);
          if (part.type === 'text' && start > offset) {
            const tail = new Text(part.data.slice(start - offset));
            part.data = part.data.slice(0, start - offset);
            moving = [tail, ...siblings.slice(i + 1)];
          }
          for (const item of moving.reverse()) DomUtils.prependChild(node, item);
          break;
        }
        offset += pieces[i].length;
      }
    }
  }
  return DomUtils.getOuterHTML(doc);
}



/** Content-first view from sanitized HTML. Re-escape text; allow only safe links.
 * Flatten layout tables, but retain each leaf row's labels next to its values. */
export function readableEmailHtml(html:string):string {
  const doc=parseDocument(html);
  const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function render(node:(typeof doc.children)[number]):string {
    if(node.type==='text')return escape(node.data);
    if(!isTag(node))return '';
    const tag=node.name;
    if(/^(?:script|style|img|svg|video|audio|iframe|blockquote|head)$/.test(tag))return '';
    const contents=()=>node.children.map(render).join('');
    if(tag==='a'){
      const href=node.attribs.href??'';
      return /^(?:https?:|mailto:|tel:)/i.test(href)?`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${contents()}</a>`:contents();
    }
    if(tag==='br')return '<br>';
    if(tag==='tr'){
      const cells=node.children.filter(n=>isTag(n)&&/^(?:td|th)$/.test(n.name));
      const nested=cells.some(c=>DomUtils.findAll(e=>e.name==='table', [c]).length>0);
      if(nested)return contents();
      const values=cells.map(render).map(s=>s.trim()).filter(Boolean);
      return values.length?`<p>${values.join(': ')}</p>`:'';
    }
    const value=contents();
    return /^(?:p|div|h[1-6]|li|section)$/.test(tag)?`<p>${value}</p>`:value;
  }
  return doc.children.map(render).join('').replace(/<p>\s*<\/p>/g,'');
}
