/** Bounded arithmetic parser. No JS evaluation, property access or implicit calls. */
export function formulaReferences(formula: string, known: ReadonlySet<string>): string[] {
 if (formula.length > 4096) throw new Error('formula_too_complex');
 const tokens = formula.match(/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?|\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
 if (tokens.join('') !== formula.replace(/\s/g,'')) throw new Error('invalid_formula');
 let at=0, depth=0; const refs=new Set<string>();
 function primary():void {
  if (++depth>32) throw new Error('formula_too_complex');
  const t=tokens[at++];
  if(t==='-' || t==='+') primary();
  else if(t==='('){ expression(); if(tokens[at++]!==')') throw new Error('invalid_formula'); }
  else if(t && /^[a-z]/.test(t)){if(!known.has(t))throw new Error(`unknown_formula_field:${t}`);refs.add(t);}
  else if(!t || !/^\d/.test(t)) throw new Error('invalid_formula');
  depth--;
 }
 function product():void {primary();while(tokens[at]==='*'||tokens[at]==='/'){at++;primary();}}
 function expression():void {product();while(tokens[at]==='+'||tokens[at]==='-'){at++;product();}}
 expression();if(at!==tokens.length)throw new Error('invalid_formula');return [...refs];
}
export function validateFormulas(entries: readonly {key:string;formula:string}[], known: ReadonlySet<string>):void {
 const graph=new Map(entries.map(e=>[e.key,formulaReferences(e.formula,known)]));
 const done=new Set<string>(), visiting=new Set<string>();
 function visit(key:string):void {if(visiting.has(key))throw new Error('formula_cycle');if(done.has(key))return;visiting.add(key);for(const ref of graph.get(key)??[])if(graph.has(ref))visit(ref);visiting.delete(key);done.add(key);}
 for(const key of graph.keys())visit(key);
}
