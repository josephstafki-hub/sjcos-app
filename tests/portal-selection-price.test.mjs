import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectionPriceLabel} from '../lib/portal-selection-price.ts';
test('only explicit notes establish included or priced elsewhere',()=>{
 assert.equal(selectionPriceLabel(0,'Included in the contract'),'Included');
 assert.equal(selectionPriceLabel(0,'Quoted with kitchen cabinets'),'Priced with other work — effect on total unconfirmed; confirm with Joe');
 for(const note of ['', 'Kitchen cabinets', 'Price pending', 'Not included', 'Not quoted with other work']) assert.equal(selectionPriceLabel(0,note),'Price not posted — confirm with Joe');
});
test('prices and credits have clear labels',()=>{
 assert.equal(selectionPriceLabel(600,''),'$600');assert.equal(selectionPriceLabel(-50,''),'$50 credit');
});

test('bundled pricing discloses unconfirmed effect before choosing',()=>{
 assert.equal(selectionPriceLabel(0,'Quoted with kitchen cabinets'),'Priced with other work — effect on total unconfirmed; confirm with Joe');
});
