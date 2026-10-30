import Link from 'next/link';
import type {ReactNode} from 'react';
const links=[['Settings','/settings'],['Pricing','/settings/pricing'],['Overhead','/settings/overhead'],['Square payments','/settings/payments'],['QuickBooks','/settings/accounting']];
export function SettingsSection({active,children}:{active:string;children:ReactNode}){
 return <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 @4xl/page:grid-cols-[160px_minmax(0,1fr)] @4xl/page:px-6">
  <nav aria-label="Settings" className="flex gap-1 overflow-x-auto @4xl/page:flex-col @4xl/page:overflow-visible">{links.map(([label,href])=><Link key={href} href={href} aria-current={href===active?'page':undefined} className={`shrink-0 rounded-md px-3 py-2 text-body ${href===active?'bg-selected font-semibold text-ink':'text-ink-3 hover:bg-hover'}`}>{label}</Link>)}</nav>
  <div className="min-w-0 max-w-2xl space-y-6">{children}</div>
 </div>;
}
