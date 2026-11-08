require('./safety.cjs').requireIsolated(process.env, 'jwt');
const jwt=require('/app/server/node_modules/jsonwebtoken');
const users=Number(process.argv[2]),bytes=Number(process.argv[3]);
if(!Number.isInteger(users)||users<1||users>20||![262144,2097152].includes(bytes))throw Error('invalid parameters');
const payload=Buffer.alloc(bytes,7);Buffer.from('89504e470d0a1a0a','hex').copy(payload);const times=[],errors=[];
async function one(i){const token=jwt.sign({typ:'access',sv:0},process.env.PERF_JWT_SECRET,{subject:`T${String(i).padStart(4,'0')}`,expiresIn:'1h'}),form=new FormData();form.append('file',new Blob([payload],{type:'image/png'}),'synthetic.png');const start=performance.now();try{const r=await fetch('http://app:3000/api/invoices/image',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.code!==0||!j.data?.fileUrl)throw Error(`http-${r.status}-code-${j.code}`);}catch(e){errors.push(e.message);}times.push(performance.now()-start);}
async function main(){const start=performance.now();await Promise.all(Array.from({length:users},(_,i)=>one(i+1)));times.sort((a,b)=>a-b);console.log(JSON.stringify({users,bytes,count:times.length,failed:errors.length,errors,p50:Math.round(times[Math.ceil(times.length*.5)-1]),p95:Math.round(times[Math.ceil(times.length*.95)-1]),max:Math.round(times.at(-1)),elapsed:Math.round(performance.now()-start)}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
