import { decodeHTML } from 'entities';
import { parseDocument, DomUtils } from 'htmlparser2';
import { isTag, type AnyNode } from 'domhandler';

/** All plain-text surfaces use the same HTML5 named/numeric/hex decoder. */
export function decodeEntities(text: string): string { return decodeHTML(text); }
export function cleanEmailText(text: string): string {
  return decodeEntities(text).replace(/\[image:[^\]]*\]/gi, '')
    .replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** A semantic text fallback, never a regex that glues adjacent table cells.
 * Layout tables flatten; comparison records retain their column labels. */
export function htmlToEmailText(html: string): string {
  const doc = parseDocument(html, { decodeEntities: false });
  function render(node: AnyNode): string {
    if (node.type === 'text') return node.data;
    if (!isTag(node)) return '';
    if (/^(?:script|style|head|img|svg)$/.test(node.name)) return '';
    if (node.name === 'br') return '\n';
    const content = () => node.children.map(render).join('');
    if (node.name === 'table') {
      const rows = DomUtils.findAll(e => e.name === 'tr', node.children).filter(row => {
        let parent = row.parent;
        while (parent && (!isTag(parent) || parent.name !== 'table')) parent = parent.parent;
        return parent === node;
      });
      const cells = (row: typeof node) => row.children.filter(isTag).filter(c => /^(?:td|th)$/.test(c.name));
      const first = rows[0] && cells(rows[0]);
      const comparison = first && first.length >= 3 && first.every(c => /[a-z]/i.test(DomUtils.textContent(c))) && rows.length > 1 && rows.every(row => cells(row).length === first.length) && !DomUtils.findOne(e => e.name === 'table', node.children, true);
      if (comparison) return '\n\n' + rows.slice(1).map(row => cells(row).map((c,i) => `${render(first[i]).trim()}: ${render(c).trim()}`).join(' · ')).join('\n\n') + '\n\n';
    }
    if (node.name === 'tr') return '\n' + node.children.filter(isTag).map(render).map(s => s.trim()).filter(Boolean).join(' · ') + '\n';
    const value = content();
    return /^(?:p|div|section|h[1-6]|li|table)$/.test(node.name) ? `\n${value}\n` : value;
  }
  return cleanEmailText(doc.children.map(render).join('')).replace(/[ \t]+/g, ' ');
}

export type EmailHtmlResult = {status: 'formatted'; html: string} | {status: 'text-only'; html: ''} | {status: 'failed'; html: ''; error: string};
export const MAX_HTML_RETRIES = 2;
export function hasEmailContent(html: string): boolean {
  const doc = parseDocument(html);
  return Boolean(DomUtils.textContent(doc).trim() || DomUtils.findOne(e => ['img','hr','video','audio'].includes(e.name), doc.children, true));
}
export async function loadEmailHtml(fetch: () => Promise<string>): Promise<EmailHtmlResult> {
  try {
    const html = await fetch();
    if (html === '') return {status: 'text-only', html: ''};
    if (!hasEmailContent(html)) throw Error('Empty formatted message');
    return {status: 'formatted', html};
  } catch {
    return {status: 'failed', html: '', error: 'Could not load formatted email. Showing text below.'};
  }
}
