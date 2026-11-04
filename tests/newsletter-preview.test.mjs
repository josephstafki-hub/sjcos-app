import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){return s==='./newsletter-design' ? n('./newsletter-design.ts',c) : n(s,c);}});
const { renderIssueHtml } = await import('../lib/newsletter-render.ts');
const { DEFAULT_SETTINGS } = await import('../lib/newsletter-design.ts');
test('newsletter markup fits a phone while retaining the email desktop width cap',()=>{
 const html=renderIssueHtml({title:'Project news',intro:'Updates from Joe',blocks:[],settings:{...DEFAULT_SETTINGS,showLogo:true}},{baseUrl:'https://example.com'});
 assert.match(html,/style="width:100%;max-width:600px;/);
 assert.doesNotMatch(html,/style="width:600px;/);
 assert.match(html,/sjc-logo\.png/);
 assert.match(html,/max-width:60%;height:auto/);
});
