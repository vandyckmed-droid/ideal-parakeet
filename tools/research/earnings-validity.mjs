// The single most robust fact in this literature: a stock jumps in the
// DIRECTION of its surprise on the day. If that isn't in the data, the
// estimates are unusable and nothing downstream means anything.
import { readFileSync, readdirSync } from 'node:fs';
const ROOT=process.cwd();
const ds=JSON.parse(readFileSync(`${ROOT}/assets/data/market.json`,'utf8'));
const DATES=ds.dates, LAST=DATES.length-1;
const idxOf=new Map(DATES.map((d,i)=>[d,i]));
function tIdx(date){ if(idxOf.has(date))return idxOf.get(date);
  let lo=0,hi=LAST; while(lo<hi){const m=(lo+hi)>>1; if(DATES[m]<date)lo=m+1; else hi=m;}
  return DATES[lo]>=date?lo:-1; }
const tk=new Map(ds.tickers.map(t=>[t.s,t]));
const cAt=(t,i)=>{const k=i-t.o; return k>=0&&k<t.p.length?t.p[k]:null;};
const mkt=new Array(DATES.length).fill(0);
for(let i=1;i<=LAST;i++){let s=0,n=0;for(const t of ds.tickers){const a=cAt(t,i-1),b=cAt(t,i);if(a&&b){s+=b/a-1;n++;}}mkt[i]=n?s/n:0;}

let beats=0,misses=0,exact=0,pairs=[];
for(const f of readdirSync(`${ROOT}/data/earnings`)){
  const t=tk.get(f.replace('.json','')); if(!t)continue;
  for(const r of JSON.parse(readFileSync(`${ROOT}/data/earnings/${f}`,'utf8'))){
    if(r.epsEstimated===null)continue;
    const s=r.epsActual-r.epsEstimated;
    if(r.date>=DATES[0]&&r.date<=DATES[LAST]){
      if(s>1e-9)beats++; else if(s<-1e-9)misses++; else exact++;
      const a=tIdx(r.date);
      if(a>0&&a+1<=LAST&&cAt(t,a-1)&&cAt(t,a+1)){
        const react=cAt(t,a+1)/cAt(t,a-1)-1-(mkt[a]+mkt[a+1]);
        const rel=r.epsEstimated!==0? s/Math.abs(r.epsEstimated):null;
        if(rel!==null&&Number.isFinite(rel))pairs.push([rel,react]);
      }
    }
  }
}
console.log(`beats ${beats}  misses ${misses}  exact ${exact}  -> beat rate ${(100*beats/(beats+misses+exact)).toFixed(1)}%`);

// sign agreement + rank correlation between surprise and the day's move
let agree=0;
for(const [s,r] of pairs) if((s>0&&r>0)||(s<0&&r<0)) agree++;
console.log(`surprise/reaction sign agreement: ${(100*agree/pairs.length).toFixed(1)}%  (n=${pairs.length}, coin flip = 50%)`);

const rank=v=>{const s=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]);const r=new Array(v.length);s.forEach((e,i)=>r[e[1]]=i);return r;};
const rx=rank(pairs.map(p=>p[0])),ry=rank(pairs.map(p=>p[1])),n=pairs.length,mu=(n-1)/2;
let num=0,dx=0,dy=0;
for(let i=0;i<n;i++){num+=(rx[i]-mu)*(ry[i]-mu);dx+=(rx[i]-mu)**2;dy+=(ry[i]-mu)**2;}
console.log(`rank correlation surprise vs same-day move: ${(num/Math.sqrt(dx*dy)).toFixed(3)}`);

// mean reaction by surprise quintile
const srt=[...pairs].sort((a,b)=>a[0]-b[0]); const q=Math.floor(n/5);
const mean=a=>a.reduce((s,x)=>s+x[1],0)/a.length;
console.log('mean 2-day move by surprise quintile: '+[0,1,2,3,4].map(i=>
  (100*mean(srt.slice(i*q, i===4?n:(i+1)*q))).toFixed(2)+'%').join('  '));
