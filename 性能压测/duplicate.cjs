require('./safety.cjs').requireIsolated(process.env, 'jwt');
const jwt=require('/app/server/node_modules/jsonwebtoken');
const token=jwt.sign({typ:'access',sv:0},process.env.PERF_JWT_SECRET,{subject:'T0001',expiresIn:'1h'});
async function main(){
  const responses=await Promise.all(Array.from({length:10},()=>fetch('http://app:3000/api/attendance/punch',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({type:'out',latitude:23.1,longitude:113.3,accuracy:10})}).then(r=>r.json())));
  const success=responses.filter(r=>r.code===0&&r.data?.ok===true).length;
  const rejected=responses.filter(r=>r.code===0&&r.data?.ok===false).length;
  console.log(JSON.stringify({requests:responses.length,success,rejected}));
  if(success!==1||rejected!==9)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
