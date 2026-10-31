import { parseDocument, DomUtils } from 'htmlparser2';

const embedded = (url: string) => /^(?:data:|cid:|#)/i.test(url.trim());
/** HTML srcset parsing keeps data-URI commas inside the URL token. */
function srcsetEntries(value:string):{url:string;descriptor:string}[] {
  const entries:{url:string;descriptor:string}[]=[];
  let rest=value;
  while(rest.trim()){
    rest=rest.replace(/^[\s,]+/,'');
    const token=/^\S+/.exec(rest)?.[0];if(!token)break;
    rest=rest.slice(token.length);
    let descriptor='';
    if(!token.endsWith(',')){
      const end=rest.indexOf(',');descriptor=(end<0?rest:rest.slice(0,end)).trim();rest=end<0?'':rest.slice(end+1);
    }
    entries.push({url:token.replace(/,+$/,''),descriptor});
  }
  return entries;
}
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
    for (const key of ['src','srcset','href','xlink:href','poster','background']) {
      const value = node.attribs[key];
      if (!value) continue;
      const media = ['poster','background','srcset'].includes(key) ||
        (key === 'src' && ['img','source','video','audio','input','embed'].includes(node.name)) ||
        (['href','xlink:href'].includes(key) && node.name === 'image');
      if (!media) continue;
      if(key==='srcset'){
        const entries=srcsetEntries(value);
        const safe=entries.filter(entry=>embedded(entry.url));
        blocked+=entries.length-safe.length;
        if(safe.length)node.attribs[key]=safe.map(e=>[e.url,e.descriptor].filter(Boolean).join(' ')).join(', ');
        else delete node.attribs[key];
      }else if(!embedded(value)){
        blocked++;
        delete node.attribs[key];
        if(key==='background')emptied.add(node);
      }

    }
    for (const key of Object.keys(node.attribs)) {
      if (key !== 'style') continue;
      const normalized=node.attribs[key].replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n]))/gi,(_,hex,char)=>hex?String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff)):char).replace(/\/\*[\s\S]*?\*\//g,'');
      node.attribs[key] = normalized.replace(/(?:background(?:-image)?|content)\s*:[^;]*image-set\([^;]*/gi,()=>{blocked++;emptied.add(node);return 'background-image:none';}).replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(all,a,b,c)=>{
        if (embedded(a ?? b ?? c ?? '')) return all;
        blocked++; emptied.add(node); return 'none';
      });
    }
    const discard = ['img','source'].includes(node.name) && !node.attribs.src && !node.attribs.srcset ||
      node.name==='image'&&!node.attribs.href&&!node.attribs['xlink:href'];
    if (discard) remove(node);
  }
  // Only prune ancestors of suppressed media. Do not discard intentional layout
  // cells, or tables containing amounts and other actual message content.
  while (emptied.size) {
    const node = emptied.values().next().value!;
    emptied.delete(node);
    if (['img','source','image','video','audio'].includes(node.name)) continue;
    if (!DomUtils.textContent(node).trim() && !DomUtils.findOne(e=>['img','video','audio','image','hr'].includes(e.name),node.children,true)) remove(node);
  }
  return {html:DomUtils.getOuterHTML(doc),blocked};
}
export function remoteImagePolicy(html: string, allow: boolean): string {
  return applyRemoteImagePolicy(html,allow).html;
}
