import { parseDocument, DomUtils } from 'htmlparser2';

const embedded = (url: string) => /^(?:data:|cid:|#)/i.test(url.trim());
/** Operates on the already-sanitized email DOM, before it enters the reader.
 * Preserve layout styles; suppress every remote media source and empty slot. */
export function applyRemoteImagePolicy(html: string, allow: boolean): {html:string;blocked:number} {
  if (allow) return {html,blocked:0};
  const doc = parseDocument(html);
  let blocked = 0;
  const emptied = new Set<import('domhandler').Element>();
  const remove = (node: import('domhandler').Element) => {
    if (node.parent?.type === 'tag') emptied.add(node.parent);
    DomUtils.removeElement(node);
  };
  for (const node of DomUtils.findAll(() => true, doc.children)) {
    let discard = false;
    for (const key of ['src','srcset','href','xlink:href','poster','background']) {
      const value = node.attribs[key];
      if (!value) continue;
      const media = ['poster','background','srcset'].includes(key) ||
        (key === 'src' && ['img','source','video','audio','input','embed'].includes(node.name)) ||
        (['href','xlink:href'].includes(key) && node.name === 'image');
      if (!media) continue;
      // A srcset descriptor is not a URL; data URLs may themselves contain commas.
      const remote = key === 'srcset'
        ? /(?:^|,\s*)(?!(?:data:|cid:|#))\s*(?:https?:|\/\/|\/?[\w.-]+\/)/i.test(value) || !embedded(value) && !/^\s*data:/i.test(value)
        : !embedded(value);
      if (remote) {
        blocked += key === 'srcset' ? Math.max(1,(value.match(/(?:https?:)?\/\/[^\s,]+/g) ?? []).length) : 1;
        delete node.attribs[key];
        if (['img','source','image'].includes(node.name)) discard = true;
      }
    }
    for (const key of Object.keys(node.attribs)) {
      if (key !== 'style') continue;
      node.attribs[key] = node.attribs[key].replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(all,a,b,c)=>{
        if (embedded(a ?? b ?? c ?? '')) return all;
        blocked++; return 'none';
      });
    }
    if (discard) remove(node);
  }
  // Only prune ancestors of suppressed media. Do not discard intentional layout
  // cells, or tables containing amounts and other actual message content.
  while (emptied.size) {
    const node = emptied.values().next().value!;
    emptied.delete(node);
    if (!DomUtils.textContent(node).trim() && !DomUtils.findOne(e=>['img','video','audio','image','hr'].includes(e.name),node.children,true)) remove(node);
  }
  return {html:DomUtils.getOuterHTML(doc),blocked};
}
export function remoteImagePolicy(html: string, allow: boolean): string {
  return applyRemoteImagePolicy(html,allow).html;
}
