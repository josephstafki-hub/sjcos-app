import {parseDocument, DomUtils} from 'htmlparser2';
import {htmlToEmailText} from './inbox-email-content.ts';
import {isTag, type Element} from 'domhandler';

export interface ReceiptField {label:string; value:string}
const fields=[
  /^(?:(?:total|amount)(?: paid| due| amount)?|(?:payment|invoice|receipt|transaction) amount|balance due|total payment)$/i,
  /^(?:paid to|payee|merchant|vendor|supplier|business)$/i,
  /^(?:(?:payment|paid|invoice|transaction|receipt) date|date(?: paid)?)$/i,
  /^(?:(?:invoice|receipt|reference|transaction|confirmation)(?:\s*(?:no\.?|number|#|id))?)$/i,
  /^(?:status|payment status)$/i,
  /^(?:(?:payment|paid by) method|payment type|paid (?:by|with)|method)$/i,
];
const fieldIndex=(s:string)=>fields.findIndex(rx=>rx.test(s.replace(/[:\s]+$/,'')));
/** Read each table's own rows, including labels/values inside layout cells.
 * Nested rows are inspected independently, never flattened into extra records. */
export function receiptFields(html:string):ReceiptField[] {
  const doc=parseDocument(html);
  const pairs:ReceiptField[]=[];
  const text=(node:Element)=>DomUtils.textContent(node).replace(/\s+/g,' ').trim();
  for(const table of DomUtils.findAll(e=>e.name==='table',doc.children)){
    const rows=DomUtils.findAll(e=>e.name==='tr',table.children).filter(row=>{
      let parent=row.parent;
      while(parent&&parent!==table){if(isTag(parent)&&parent.name==='table')return false;parent=parent.parent;}
      return parent===table;
    }).map(row=>row.children.filter(isTag).filter(c=>/^(td|th)$/.test(c.name)).map(text).filter(Boolean)).filter(r=>r.length);
    const header=rows[0];
    if(!header)continue;
    if(header.length>=3&&header.filter(c=>fieldIndex(c)>=0).length<2&&rows.length>1&&DomUtils.findOne(e=>e.name==='th',table.children,true))return [];
    if(header.length>=3&&header.filter(c=>fieldIndex(c)>=0).length>=2){
      if(rows.length!==2)return []; // several records: retain the columns
      pairs.push(...header.map((label,i)=>({label,value:rows[1][i]??''})));
    }else{
      pairs.push(...rows.filter(row=>row.length===2&&fieldIndex(row[0])>=0).map(([label,value])=>({label,value})));
    }
  }
  // Receipt summaries often put the payee and paid date above the details table.
  // Extract only explicitly labelled facts or a payment sentence, never guess a merchant.
  const prose=htmlToEmailText(html).replace(/\s+/g,' ');
  const date='(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|[A-Z][a-z]+ \\d{1,2},? \\d{4})';
  const payment=new RegExp(`\\b(?:paid to|payee[: ]|to)\\s+(.{2,100}?)\\s+on\\s+(${date})`,'i').exec(prose);
  if(payment){pairs.push({label:'Payee',value:payment[1]},{label:'Payment date',value:payment[2]});}
  const total=/\byou paid\s+((?:[A-Z]{3}\s*)?[$€£][\d,]+(?:\.\d{2})?)/i.exec(prose);
  if(total&&!pairs.some(p=>fieldIndex(p.label)===0&&/total|amount paid|payment amount/i.test(p.label)))pairs.push({label:'Amount paid',value:total[1]});
  const recognized=pairs.filter(p=>p.value&&p.value.length<600&&fieldIndex(p.label)>=0);
  const unique=new Map<string,ReceiptField>();
  for(const pair of recognized){
    const key=pair.label.toLowerCase().replace(/[:\s]+$/,'');
    // Separate receipts/records must not be merged into one compact summary.
    if(unique.has(key)&&unique.get(key)!.value!==pair.value)return [];
    unique.set(key,pair);
  }
  const kinds=new Set(recognized.map(p=>fieldIndex(p.label)));
  // Need monetary identity plus another receipt field, not an arbitrary layout.
  if(!kinds.has(0)||kinds.size<2||!/(?:receipt|invoice|payment|paid|transaction)/i.test(DomUtils.textContent(doc)))return [];
  const values=[...unique.values()];
  const hasTotal=values.some(p=>fieldIndex(p.label)===0&&/total|amount paid|payment amount/i.test(p.label));
  const priority=(p:ReceiptField)=>hasTotal&&fieldIndex(p.label)===0&&!/total|amount paid|payment amount/i.test(p.label)?6:fieldIndex(p.label);
  return values.sort((a,b)=>priority(a)-priority(b));
}
export function useCompactReceipt(fields:ReceiptField[],overflow:boolean,choice:'compact'|'formatted'|null) {
  return fields.length>0&&(choice==='compact'||choice===null&&overflow);
}
