import {parseDocument, DomUtils} from 'htmlparser2';
import {isTag, type Element} from 'domhandler';

export interface ReceiptField {label:string; value:string}
const fields=[
  /^(?:(?:total|amount)(?: paid| due)?|payment amount|balance due|total payment)$/i,
  /^(?:paid to|payee|merchant|vendor|supplier|business)$/i,
  /^(?:(?:payment|paid|invoice|transaction|receipt) date|date(?: paid)?)$/i,
  /^(?:(?:invoice|receipt|reference|transaction|confirmation)(?:\s*(?:no\.?|number|#|id))?)$/i,
  /^(?:status|payment status)$/i,
];
const fieldIndex=(s:string)=>fields.findIndex(rx=>rx.test(s.replace(/[:\s]+$/,'')));
/** Inspect leaf tables only. Multi-record/comparison grids are never receipts. */
export function receiptFields(html:string):ReceiptField[] {
  const doc=parseDocument(html);
  const pairs:ReceiptField[]=[];
  const text=(node:Element)=>DomUtils.textContent(node).replace(/\s+/g,' ').trim();
  for(const table of DomUtils.findAll(e=>e.name==='table',doc.children)){
    if(DomUtils.findOne(e=>e.name==='table',table.children,true))continue;
    const rows=DomUtils.findAll(e=>e.name==='tr',table.children).map(row=>row.children.filter(isTag).filter(c=>/^(td|th)$/.test(c.name)).map(text)).filter(r=>r.length);
    const header=rows[0];
    if(!header)continue;
    if(header.length>=3&&header.filter(c=>fieldIndex(c)>=0).length>=2){
      if(rows.length!==2)return []; // several records: retain the columns
      pairs.push(...header.map((label,i)=>({label,value:rows[1][i]??''})));
    }else{
      pairs.push(...rows.filter(row=>row.length===2&&fieldIndex(row[0])>=0).map(([label,value])=>({label,value})));
    }
  }
  const recognized=pairs.filter(p=>p.value&&p.value.length<600&&fieldIndex(p.label)>=0);
  const kinds=new Set(recognized.map(p=>fieldIndex(p.label)));
  // Need monetary identity plus another receipt field, not an arbitrary layout.
  if(!kinds.has(0)||kinds.size<2||!/(?:receipt|invoice|payment|paid|transaction)/i.test(DomUtils.textContent(doc)))return [];
  return recognized.sort((a,b)=>fieldIndex(a.label)-fieldIndex(b.label));
}
export function useCompactReceipt(fields:ReceiptField[],overflow:boolean,choice:'compact'|'formatted'|null) {
  return fields.length>0&&(choice==='compact'||choice===null&&overflow);
}
