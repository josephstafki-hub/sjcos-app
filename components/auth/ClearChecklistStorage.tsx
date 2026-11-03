"use client";
import {useEffect} from 'react';
import {clearSignedIn} from '@/components/calls/checklist/signed-in';
import {clearAllPending} from '@/lib/checklist-coverage/offline-store';
export function ClearChecklistStorage() {
 useEffect(()=>{clearSignedIn();void clearAllPending(typeof indexedDB==='undefined'?undefined:indexedDB);},[]);
 return null;
}
