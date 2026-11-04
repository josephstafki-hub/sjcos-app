export interface InquiryLinkReceipt {inquiryId:string;threadId:string;sentAt:number}
export function inquiryLinkKey(mailbox:string,userId:string,inquiryId:string):string {
  return JSON.stringify(['sjc:inbox:inquiry-link:v1',mailbox.toLowerCase(),userId,inquiryId]);
}
export function readInquiryLink(storage:Pick<Storage,'getItem'>,key:string):InquiryLinkReceipt|null {
  try{
    const value=JSON.parse(storage.getItem(key)??'null');
    return value&&typeof value.inquiryId==='string'&&typeof value.threadId==='string'&&value.threadId&&Number.isFinite(value.sentAt)?value:null;
  }catch{return null;}
}
export function saveInquiryLinkReceipt(storage:Pick<Storage,'setItem'|'removeItem'>,key:string,receipt:InquiryLinkReceipt|null):boolean {
  try{if(receipt)storage.setItem(key,JSON.stringify(receipt));else storage.removeItem(key);return true;}catch{return false;}
}
