// Every cell reported, none hidden. 24 tests at 5% means ~1 will look
// "significant" by chance alone - that has to be read into any winner.
import { readFileSync, readdirSync } from 'node:fs';
const ROOT=process.cwd();
const ds=JSON.parse(readFileSync(`${ROOT}/assets/data/market.json`,'utf8'));
const DATES=ds.dates, LAST=DATES.length-1;
const idxOf=new Map(DATES.map((d,i)=>[d,i]));
function tIdx(d){ if(idxOf.has(d))return idxOf.get(d);
  let lo=0,hi=LAST; while(lo<hi){const m=(lo+hi)>>1; if(DATES[m]<d)lo=m+1; else hi=m;}
  return DATES[lo]>=d?lo:-1;}
const tk=new Map(ds.tickers.map(t=>[t.s,t]));
const cAt=(t,i)=>{const k=i-t.o; return k>=0&&k<t.p.length?t.p[k]:null;};
const mkt=new Array(DATES.length).fill(0);
for(let i=1;i<=LAST;i++){let s=0,n=0;for(const t of ds.tickers){const a=cAt(t,i-1),b=cAt(t,i);if(a&&b){s+=b/a-1;n++;}}mkt[i]=n?s/n:0;}
const cum=new Array(DATES.length).fill(0);
for(let i=1;i<=LAST;i++)cum[i]=cum[i-1]+mkt[i];

const caps=ds.tickers.map(t=>t.mc).sort((a,b)=>a-b);
const smallCut=caps[Math.floor(caps.length*0.2)];

const base=[];
for(const f of readdirSync(`${ROOT}/data/earnings`)){
  const sym=f.replace('.json',''); const t=tk.get(sym); if(!t)continue;
  const rep=JSON.parse(readFileSync(`${ROOT}/data/earnings/${f}`,'utf8'));
  for(let k=0;k<rep.length;k++){
    const r=rep[k]; if(r.epsEstimated===null)continue;
    const prior=[];
    for(let j=k-1;j>=0&&prior.length<8;j--){const p=rep[j]; if(p.epsEstimated!==null)prior.push(p.epsActual-p.epsEstimated);}
    if(prior.length<6)continue;
    const mu=prior.reduce((a,b)=>a+b,0)/prior.length;
    const sd=Math.sqrt(prior.reduce((a,b)=>a+(b-mu)**2,0)/(prior.length-1));
    if(!(sd>1e-6))continue;
    const sur=r.epsActual-r.epsEstimated;
    const a=tIdx(r.date); if(a<1)continue;
    if(!cAt(t,a-1)||!cAt(t,a+1))continue;
    base.push({sym, small:t.mc<=smallCut, ann:a, t,
      sue:sur/sd, pct:r.epsEstimated!==0?sur/Math.abs(r.epsEstimated):null,
      react:cAt(t,a+1)/cAt(t,a-1)-1-(cum[a+1]-cum[a-1])});
  }
}

function cell(sig,hold,subset){
  const rows=[];
  for(const o of base){
    if(subset==='small'&&!o.small)continue;
    const e=o.ann+2, x=o.ann+2+hold;
    if(x>LAST)continue;
    if(!cAt(o.t,e)||!cAt(o.t,x))continue;
    const v=o[sig]; if(v===null||!Number.isFinite(v))continue;
    rows.push({v, ab:cAt(o.t,x)/cAt(o.t,e)-1-(cum[x]-cum[e])});
  }
  if(rows.length<200)return null;
  rows.sort((a,b)=>a.v-b.v);
  const q=Math.floor(rows.length/5);
  const m=a=>a.reduce((s,x)=>s+x.ab,0)/a.length;
  const vr=a=>{const u=m(a);return a.reduce((s,x)=>s+(x.ab-u)**2,0)/(a.length-1);};
  const lo=rows.slice(0,q), hi=rows.slice(-q);
  const sp=m(hi)-m(lo), se=Math.sqrt(vr(hi)/q+vr(lo)/q);
  return {n:rows.length, sp, t:sp/se};
}

console.log('top-minus-bottom quintile, market-relative, entry +2d\n');
console.log('signal        subset   hold    n     spread      t');
for(const sig of ['sue','pct','react'])
 for(const sub of ['all','small'])
  for(const h of [5,10,20,60]){
    const c=cell(sig,h,sub); if(!c)continue;
    const flag=Math.abs(c.t)>=2?'  <-':'';
    console.log(`${sig.padEnd(13)} ${sub.padEnd(7)} ${String(h).padStart(3)}d ${String(c.n).padStart(6)}  ${(c.sp*100).toFixed(2).padStart(7)}%  ${c.t.toFixed(2).padStart(6)}${flag}`);
  }
