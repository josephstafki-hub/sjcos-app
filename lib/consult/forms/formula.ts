/** Bounded expression AST; never executes JavaScript. Comparisons yield 0/1. */
type Node = {kind:'number';value:number}|{kind:'ref';key:string}|{kind:'call';name:string;args:Node[]}|{kind:'binary';op:string;left:Node;right:Node}|{kind:'branch';test:Node;yes:Node;no:Node};
function parse(formula:string):Node {
 if(formula.length>4096)throw new Error('formula_too_complex');
 const tokens=formula.match(/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,2}|\d+(?:\.\d+)?|<=|>=|==|!=|[<>()+*/?,:-]/g)??[];
 if(tokens.join('')!==formula.replace(/\s/g,''))throw new Error('invalid_formula');
 let at=0,depth=0;
 function primary():Node{
  if(++depth>32)throw new Error('formula_too_complex');const t=tokens[at++];let n:Node;
  if(t==='+'||t==='-')n={kind:'binary',op:t,left:{kind:'number',value:0},right:primary()};
  else if(t==='('){n=expression();if(tokens[at++]!==')')throw new Error('invalid_formula');}
  else if(t&&/^[a-z]/.test(t)){
   if(tokens[at]==='('){at++;const args=[expression()];while(tokens[at]===','){at++;args.push(expression());}if(tokens[at++]!==')'||!['sqrt','ceil','abs','min','max'].includes(t)||(['min','max'].includes(t)?args.length<2:args.length!==1))throw new Error('invalid_formula');n={kind:'call',name:t,args};}
   else n={kind:'ref',key:t};
  }else if(t&&/^\d/.test(t))n={kind:'number',value:Number(t)};else throw new Error('invalid_formula');
  depth--;return n;
 }
 const binary=(next:()=>Node,ops:string[])=>{let n=next();while(ops.includes(tokens[at])){const op=tokens[at++];n={kind:'binary',op,left:n,right:next()};}return n;};
 const product=()=>binary(primary,['*','/']);const sum=()=>binary(product,['+','-']);const comparison=()=>binary(sum,['<','>','<=','>=','==','!=']);
 function expression():Node{let n=comparison();if(tokens[at]==='?'){at++;const yes=expression();if(tokens[at++]!==':')throw new Error('invalid_formula');n={kind:'branch',test:n,yes,no:expression()};}return n;}
 const n=expression();if(at!==tokens.length)throw new Error('invalid_formula');return n;
}
function references(n:Node):string[]{return n.kind==='ref'?[n.key]:n.kind==='number'?[]:n.kind==='binary'?[...references(n.left),...references(n.right)]:n.kind==='branch'?[...references(n.test),...references(n.yes),...references(n.no)]:n.args.flatMap(references);}
export function formulaReferences(formula:string,known:ReadonlySet<string>):string[]{const refs=[...new Set(references(parse(formula)))];for(const r of refs)if(!known.has(r))throw new Error(`unknown_formula_field:${r}`);return refs;}
export function validateFormulas(entries:readonly {key:string;formula:string}[],known:ReadonlySet<string>):void{
 const graph=new Map(entries.map(e=>[e.key,formulaReferences(e.formula,known)])),done=new Set<string>(),visiting=new Set<string>();
 function visit(k:string){if(visiting.has(k))throw new Error('formula_cycle');if(done.has(k))return;visiting.add(k);for(const r of graph.get(k)??[])if(graph.has(r))visit(r);visiting.delete(k);done.add(k);}for(const k of graph.keys())visit(k);
}
export function formulaTerms(formula:string):string[]{
 // Preserve parentheses and branch expressions; only additive root nodes distribute.
 const render=(n:Node):string=>n.kind==='number'?String(n.value):n.kind==='ref'?n.key:n.kind==='call'?`${n.name}(${n.args.map(render).join(',')})`:n.kind==='branch'?`(${render(n.test)}?${render(n.yes)}:${render(n.no)})`:`(${render(n.left)}${n.op}${render(n.right)})`;
 function terms(n:Node,sign=1):string[]{return n.kind==='binary'&&(n.op==='+'||n.op==='-')?[...terms(n.left,sign),...terms(n.right,n.op==='-'?-sign:sign)]:[`${sign<0?'-':''}${render(n)}`];}return terms(parse(formula));
}
export function evaluateFormula(formula:string,values:Readonly<Record<string,number|undefined>>):number|null{
 const ast=parse(formula);formulaReferences(formula,new Set(Object.keys(values)));
 function run(n:Node):number{
  if(n.kind==='number')return n.value;if(n.kind==='ref')return values[n.key]??NaN;
  if(n.kind==='branch'){const t=run(n.test);return Number.isFinite(t)?run(t?n.yes:n.no):NaN;}
  if(n.kind==='call'){const a=n.args.map(run);return n.name==='sqrt'?Math.sqrt(a[0]):n.name==='ceil'?Math.ceil(a[0]):n.name==='abs'?Math.abs(a[0]):n.name==='min'?Math.min(...a):Math.max(...a);}
  const a=run(n.left),b=run(n.right);if(!Number.isFinite(a)||!Number.isFinite(b))return NaN;
  switch(n.op){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return b===0?NaN:a/b;case '<':return +(a<b);case '>':return +(a>b);case '<=':return +(a<=b);case '>=':return +(a>=b);case '==':return +(a===b);case '!=':return +(a!==b);}return NaN;
 }const result=run(ast);return Number.isFinite(result)?Math.round(result*10000)/10000:null;
}
