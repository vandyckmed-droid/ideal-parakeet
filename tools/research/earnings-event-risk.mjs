// If the drift isn't tradeable, is the EVENT at least worth knowing about?
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

const annDays=new Map(); // symbol -> Set of announcement indices
for(const f of readdirSync(`${ROOT}/data/earnings`)){
  const sym=f.replace('.json',''); if(!tk.has(sym))continue;
  const set=new Set();
  for(const r of JSON.parse(readFileSync(`${ROOT}/data/earnings/${f}`,'utf8'))){
    const a=tIdx(r.date); if(a>0&&a<LAST)set.add(a);
  }
  annDays.set(sym,set);
}

let evAbs=[], normAbs=[];
for(const t of ds.tickers){
  const set=annDays.get(t.s)||new Set();
  for(let i=1;i<LAST;i++){
    const a=cAt(t,i-1), b=cAt(t,i+1);
    if(!a||!b)continue;
    const move=Math.abs(b/a-1-(mkt[i]+mkt[i+1]));
    // near an announcement? (the day itself or the one after)
    if(set.has(i)||set.has(i-1)) evAbs.push(move); else normAbs.push(move);
  }
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length*p)];};
console.log(`earnings 2-day |abnormal move|:  mean ${(100*mean(evAbs)).toFixed(2)}%  median ${(100*pct(evAbs,0.5)).toFixed(2)}%  90th ${(100*pct(evAbs,0.9)).toFixed(2)}%   n=${evAbs.length}`);
console.log(`ordinary 2-day |abnormal move|:  mean ${(100*mean(normAbs)).toFixed(2)}%  median ${(100*pct(normAbs,0.5)).toFixed(2)}%  90th ${(100*pct(normAbs,0.9)).toFixed(2)}%   n=${normAbs.length}`);
console.log(`earnings days are ${(mean(evAbs)/mean(normAbs)).toFixed(2)}x the ordinary move`);
