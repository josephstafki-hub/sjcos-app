/** Applied before injecting HTML, so blocked images never enter the live DOM.
 * Inline cid/data images stay available; strip remote CSS URLs as well. */
export function remoteImagePolicy(html: string, allow: boolean): string {
  if (allow) return html;
  return html.replace(/<img\b[^>]*>/gi, tag=>tag.replace(/\s(?:src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,(attr,a,b,c)=>/^(?:data:|cid:)/i.test(a??b??c??'')?attr:''))
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
    .replace(/\s(?:background|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
    .replace(/url\s*\([^)]*\)/gi,'none');
}
