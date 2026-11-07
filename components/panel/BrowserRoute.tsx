'use client';
import {useEffect} from 'react';
import {useSearchParams} from 'next/navigation';
/** Canonical Today query changes can occur without remounting the shared host. */
export function BrowserRoute(){
 const query=useSearchParams();const key=query.toString();
 useEffect(()=>{window.dispatchEvent(new Event('sjcos:browser-route'));},[key]);
 return null;
}
