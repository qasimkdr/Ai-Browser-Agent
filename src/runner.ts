import {chromium,Page} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {decide,makePlan} from "./agent.js";
import {perform} from "./executor.js";
import {observe} from "./observer.js";
import {Watchdog} from "./watchdog.js";
import {openGmail,findOtp,GmailCredential} from "./gmail.js";
import {addEvent,getIdentity,getMemory,getPlan,saveIdentity,saveMemory,savePlan,saveResult} from "./db.js";
import {makeTestIdentity,nextUsername,prefillAuthorizedForm} from "./identity.js";
import type {Memory} from "./types.js";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function collect(page:Page){return page.locator("input,textarea,select").evaluateAll((els:any[])=>Object.fromEntries(els.map(e=>[e.name||e.id||e.getAttribute("aria-label")||e.placeholder||"unnamed",/password/i.test(e.type||"")?"[REDACTED]":e.value||""]).filter((x:any[])=>x[1]!=="")))}
async function parseList(file:string):Promise<GmailCredential[]>{const raw=await fs.readFile(file,"utf8");return raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const [email,password]=line.split(",").map(x=>x.trim());return{email,password}}).filter(x=>!!x.email&&!!x.password)}
async function shot(page:Page,dir:string,name:string){await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`${Date.now()}-${name}.png`);await page.screenshot({path:file,fullPage:false});return file}
function checkpointUrl(baseUrl:string,lastUrl?:string){try{if(!lastUrl)return baseUrl;const a=new URL(baseUrl),b=new URL(lastUrl);return a.hostname===b.hostname&&["http:","https:"].includes(b.protocol)?b.toString():baseUrl}catch{return baseUrl}}

export async function runJob(o:{jobId:string;url:string;goal:string;count:number;gmailFile:string;showBrowser:boolean;startAccount?:number;onStatus:(s:string,a?:number)=>void;shouldStop:()=>boolean;shouldPause:()=>boolean}){
 const creds=await parseList(o.gmailFile);if(creds.length<o.count)throw new Error(`Need at least ${o.count} Gmail entries.`);await fs.mkdir(path.join("data","profiles",o.jobId),{recursive:true});
 for(let i=o.startAccount||1;i<=o.count;i++){
  if(o.shouldStop())return;
  while(o.shouldPause()){o.onStatus(`Paused before account ${i}/${o.count}`,i);await sleep(800);if(o.shouldStop())return}
  const base=path.join("data","profiles",o.jobId);const screenshots=path.join("data","screenshots",o.jobId,String(i).padStart(4,"0"));let gmail:any,ctx:any;
  const identity=getIdentity(o.jobId,i)||makeTestIdentity(creds[i-1].email);saveIdentity(o.jobId,i,identity);
  const resumeMemory=getMemory(o.jobId,i);
  const result:any={accountNumber:i,email:identity.email,username:identity.username,status:"running",fields:{},createdAt:new Date().toISOString()};
  try{
   gmail=await openGmail(creds[i-1],path.join(base,`gmail-${String(i).padStart(4,"0")}`),s=>o.onStatus(s,i),o.showBrowser);
   ctx=await chromium.launchPersistentContext(path.join(base,`site-${String(i).padStart(4,"0")}`),{headless:!o.showBrowser,viewport:{width:1365,height:900},slowMo:Number(process.env.BROWSER_SLOW_MO||80)});
   const page=ctx.pages()[0]||await ctx.newPage();const startUrl=checkpointUrl(o.url,resumeMemory?.lastUrl);await page.goto(startUrl,{waitUntil:"domcontentloaded",timeout:60000});addEvent(o.jobId,i,"navigation",resumeMemory?.lastUrl?"Resumed authorized checkpoint URL":"Opened authorized target website",{url:startUrl});
   let snap=await observe(page);let plan=getPlan(o.jobId,i);if(!plan.length){plan=await makePlan(o.goal,snap);savePlan(o.jobId,i,plan);addEvent(o.jobId,i,"plan","Created workflow plan",plan)}
   let memory:Memory=resumeMemory||{jobId:o.jobId,accountNumber:i,stage:plan[0]?.title||"Inspect page",completed:[],remaining:plan.map(x=>x.title),failedActions:[],loopCount:0,lastUrl:page.url(),currentStep:0,updatedAt:new Date().toISOString()};const watchdog=new Watchdog();
   for(let step=memory.currentStep||0;step<Number(process.env.MAX_STEPS||100);step++){
    while(o.shouldPause()){o.onStatus(`Paused on account ${i}/${o.count}`,i);await sleep(800);if(o.shouldStop())break}if(o.shouldStop()){result.status="stopped";break}
    snap=await observe(page);memory.currentStep=step;memory.lastUrl=snap.url;memory.updatedAt=new Date().toISOString();saveMemory(memory);
    if(/captcha|anti[- ]bot|identity verification|security check|two[- ]step|2fa/i.test(snap.text)){result.status="paused";result.error="Manual verification required";await shot(page,screenshots,"manual-verification");addEvent(o.jobId,i,"manual","Manual security verification required");saveMemory(memory);break}

    const prefill=await prefillAuthorizedForm(page,identity).catch(()=>({filled:0}));
    if(prefill.filled){addEvent(o.jobId,i,"form",`Filled ${prefill.filled} recognized test field(s)`);await page.waitForTimeout(250);snap=await observe(page)}

    if(/user(name)?.{0,25}(taken|unavailable|already exists|not available)/i.test(`${snap.text} ${snap.errors.join(" ")}`)){
      nextUsername(identity);saveIdentity(o.jobId,i,identity);addEvent(o.jobId,i,"form","Generated another test username after validation rejection");
      const userEl=snap.elements.find(e=>/user.*name|handle/i.test(`${e.label||""} ${e.name||""} ${e.placeholder||""}`));
      if(userEl){await page.locator(`[data-agent-id="${userEl.id}"]`).fill(identity.username);memory.currentStep=step+1;saveMemory(memory);continue}
    }

    if(/verification code|verification email|enter code|one[- ]time password|\botp\b/i.test(snap.text)){
      o.onStatus(`Account ${i}: checking Gmail for verification code`,i);const otpResult=await findOtp(gmail.page,new URL(o.url).hostname);const otp=typeof otpResult==="string"?otpResult:otpResult?.code;
      if(otp){const codeEl=snap.elements.find(e=>/code|otp|verification/i.test(`${e.label} ${e.name} ${e.placeholder}`));if(codeEl){await page.locator(`[data-agent-id="${codeEl.id}"]`).fill(otp);addEvent(o.jobId,i,"verification","Filled verification code from Gmail",typeof otpResult==="object"?{score:otpResult?.score,attempt:otpResult?.attempt}:undefined);memory.currentStep=step+1;saveMemory(memory);continue}}
    }

    const image=(await page.screenshot({type:"png"})).toString("base64");let action=await decide(snap,image,`${o.goal}\nAuthorized test identity is already persisted for this profile. Reuse values already present in recognized fields; do not invent a different email.`,memory,plan);
    if(action.confidence<.5){addEvent(o.jobId,i,"confidence",`Low-confidence action (${Math.round(action.confidence*100)}%) — re-observing`);await page.waitForTimeout(700);continue}
    o.onStatus(`Account ${i}/${o.count}: ${action.type} (${Math.round(action.confidence*100)}%)`,i);addEvent(o.jobId,i,"action",`${action.type}: ${action.reason||action.target||action.elementId||""}`,{confidence:action.confidence});
    if(action.type==="done"){result.status="success";memory.completed.push(memory.stage);memory.remaining=[];memory.currentStep=step+1;saveMemory(memory);break}
    if(action.type==="pause"){result.status="paused";result.error=action.reason||"Agent requested manual review";await shot(page,screenshots,"paused");saveMemory(memory);break}
    const signature=JSON.stringify({type:action.type,elementId:action.elementId,target:action.target,text:action.text});
    if(watchdog.check(snap.url,snap.text,signature)){memory.loopCount++;memory.lastError="Loop detected";addEvent(o.jobId,i,"watchdog","Loop detected; changing strategy");action=await decide(snap,image,o.goal,memory,plan,"Previous strategy repeated without changing the page. Choose a different safe action.");watchdog.reset()}
    let ok=false,lastErr="";for(let attempt=1;attempt<=3&&!ok;attempt++){try{await perform(page,action);ok=true;memory.lastAction=signature;await page.waitForTimeout(350)}catch(e:any){lastErr=e?.message||String(e);memory.failedActions.push(`${signature} :: ${lastErr}`);addEvent(o.jobId,i,"recovery",`Action failed; recovery attempt ${attempt}/3`,{error:lastErr});if(attempt<3){const now=await observe(page);const im=(await page.screenshot({type:"png"})).toString("base64");action=await decide(now,im,o.goal,memory,plan,`Action failed: ${lastErr}. Resolve the same subtask using a different selector/action.`)}}}
    if(!ok){memory.lastError=lastErr;await shot(page,screenshots,"action-failed")}
    memory.currentStep=step+1;memory.lastUrl=page.url();memory.updatedAt=new Date().toISOString();saveMemory(memory);saveIdentity(o.jobId,i,identity);if(step%5===0)await shot(page,screenshots,`step-${step}`);
   }
   result.username=identity.username;result.fields=await collect(page);result.finalUrl=page.url();result.finishedAt=new Date().toISOString();if(result.status==="running")result.status="failed";
  }catch(e:any){result.status="failed";result.error=e?.message||String(e);addEvent(o.jobId,i,"error",result.error)}finally{saveIdentity(o.jobId,i,identity);saveResult(o.jobId,i,result);await ctx?.close().catch(()=>{});await gmail?.ctx?.close().catch(()=>{})}
  if(result.status==="paused")return;
 }
}
