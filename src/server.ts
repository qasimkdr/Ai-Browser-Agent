import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {runJob} from "./runner.js";
import {listProfiles,openSavedProfile} from "./profiles.js";
import {addEvent,getJob,listEvents,listIdentities,listJobs,listResults,restoreInterruptedJobs,saveJob} from "./db.js";
import {allowedUrl,redact,timingSafeBearer} from "./security.js";
import type {Job} from "./types.js";

restoreInterruptedJobs();
await fs.mkdir("data/uploads",{recursive:true});
const app=express();
const upload=multer({dest:"data/uploads",limits:{fileSize:2*1024*1024}});
app.use(express.json({limit:"256kb"}));
app.use("/api",(req,res,next)=>timingSafeBearer(req.headers.authorization)?next():res.status(401).json({error:"Unauthorized"}));
app.use(express.static("public"));

const privateFiles=new Map<string,string>();
const workers=new Set<string>();
function pub(j:Job){return redact({...j,stopped:undefined,paused:undefined})}
function startWorker(job:Job,gmailFile:string,startAccount?:number){
 if(workers.has(job.jobId))return;
 workers.add(job.jobId);privateFiles.set(job.jobId,gmailFile);job.status="running";job.paused=false;job.stopped=false;saveJob(job);
 runJob({jobId:job.jobId,url:job.url,goal:job.goal,count:job.count,gmailFile,showBrowser:job.showBrowser,startAccount,onStatus:(s,a)=>{const j=getJob(job.jobId);if(!j)return;j.statusText=s;if(a)j.currentAccount=a;saveJob(j);addEvent(j.jobId,a||null,"status",s)},shouldStop:()=>getJob(job.jobId)?.stopped===true,shouldPause:()=>getJob(job.jobId)?.paused===true})
 .then(()=>{const j=getJob(job.jobId);if(!j)return;const rr=listResults(job.jobId);j.successCount=rr.filter(x=>x.status==="success").length;j.failedCount=rr.filter(x=>x.status==="failed").length;if(j.stopped){j.status="stopped";j.statusText="Stopped by user"}else if(j.paused){j.status="paused"}else{j.status="completed";j.statusText="Job completed"}saveJob(j)})
 .catch((e:any)=>{const j=getJob(job.jobId);if(j){j.status="failed";j.error=e?.message||String(e);j.statusText="Job failed";saveJob(j)}})
 .finally(()=>workers.delete(job.jobId));
}

app.post("/api/start",upload.single("gmailList"),async(req,res)=>{
 const url=String(req.body.url||"").trim(),goal=String(req.body.goal||"Complete authorized browser workflow").trim(),count=Math.max(1,Math.min(1000,Number(req.body.count||1))),showBrowser=String(req.body.showBrowser??"true")!=="false";
 if(!process.env.ALLOWED_DOMAINS?.trim())return res.status(400).json({error:"Set ALLOWED_DOMAINS before starting automated form workflows."});
 if(!allowedUrl(url))return res.status(400).json({error:"URL is invalid or not in ALLOWED_DOMAINS."});
 if(!req.file)return res.status(400).json({error:"Upload a private Gmail TXT/CSV list."});
 if(!/\.(txt|csv)$/i.test(req.file.originalname))return res.status(400).json({error:"Only TXT/CSV files are accepted."});
 const jobId=`${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;const gmailFile=path.join("data/uploads",`${jobId}.private`);await fs.rename(req.file.path,gmailFile);const now=new Date().toISOString();
 const job:Job={jobId,status:"queued",statusText:"Queued",url,goal,count,currentAccount:0,successCount:0,failedCount:0,createdAt:now,updatedAt:now,showBrowser,stopped:false,paused:false};saveJob(job);addEvent(jobId,null,"job","Authorized test job created");res.json({jobId});startWorker(job,gmailFile);
});

app.get("/api/jobs",(req,res)=>res.json(listJobs().map(pub)));
app.get("/api/jobs/:id",(req,res)=>{const j=getJob(req.params.id);return j?res.json(pub(j)):res.status(404).json({error:"Job not found"})});
app.get("/api/jobs/:id/events",(req,res)=>res.json(listEvents(req.params.id,Number(req.query.limit||300))));
app.get("/api/jobs/:id/results",(req,res)=>res.json(redact(listResults(req.params.id))));
app.get("/api/jobs/:id/export",(req,res)=>{
 if(!process.env.DASHBOARD_TOKEN?.trim())return res.status(403).json({error:"Set DASHBOARD_TOKEN before exporting stored test credentials."});
 const job=getJob(req.params.id);if(!job)return res.status(404).json({error:"Job not found"});
 const identities=listIdentities(req.params.id),results=listResults(req.params.id);const combined=identities.map((x,i)=>({...x,accountNumber:i+1,status:results[i]?.status||"unknown",finalUrl:results[i]?.finalUrl||""}));
 const format=String(req.query.format||"json").toLowerCase();
 if(format==="csv"){
  const cols=["accountNumber","email","username","password","firstName","lastName","fullName","phone","birthDate","status","finalUrl","createdAt"];
  const esc=(v:any)=>`"${String(v??"").replace(/"/g,'""')}"`;
  const csv=[cols.join(","),...combined.map(r=>cols.map(c=>esc((r as any)[c])).join(","))].join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="${req.params.id}-test-identities.csv"`);return res.send(csv);
 }
 res.setHeader("Content-Disposition",`attachment; filename="${req.params.id}-test-identities.json"`);return res.json(combined);
});

app.post("/api/jobs/:id/pause",(req,res)=>{const j=getJob(req.params.id);if(!j)return res.status(404).json({error:"Job not found"});j.paused=true;j.status="paused";j.statusText="Paused by user";saveJob(j);addEvent(j.jobId,j.currentAccount||null,"control","Paused by user");res.json({ok:true})});
app.post("/api/jobs/:id/resume",(req,res)=>{const j=getJob(req.params.id);if(!j)return res.status(404).json({error:"Job not found"});j.paused=false;if(workers.has(j.jobId)){j.status="running";j.statusText="Resuming";saveJob(j);return res.json({ok:true})}const file=privateFiles.get(j.jobId)||path.join("data/uploads",`${j.jobId}.private`);fs.access(file).then(()=>startWorker(j,file,Math.max(1,j.currentAccount||1))).catch(()=>{});j.status="starting";j.statusText="Restarting worker from checkpoint";saveJob(j);res.json({ok:true})});
app.post("/api/jobs/:id/stop",(req,res)=>{const j=getJob(req.params.id);if(!j)return res.status(404).json({error:"Job not found"});j.stopped=true;j.paused=false;j.status="stopped";j.statusText="Stopping";saveJob(j);addEvent(j.jobId,j.currentAccount||null,"control","Stop requested");res.json({ok:true})});
app.get("/api/profiles",async(req,res)=>res.json(await listProfiles()));
app.post("/api/profiles/open",async(req,res)=>{const dir=String(req.body.profileDir||"");const allowed=(await listProfiles()).some(p=>p.profileDir===dir);if(!allowed)return res.status(400).json({error:"Unknown saved profile"});try{await openSavedProfile(dir);res.json({ok:true})}catch(e:any){res.status(500).json({error:e?.message||String(e)})}});
app.get("/api/health",(req,res)=>res.json({ok:true,version:"6.0.0",browserVisibleByDefault:true,authorizedDomainsRequired:true,credentialExportRequiresDashboardToken:true}));
app.listen(Number(process.env.PORT||3000),"0.0.0.0",()=>console.log(`AI Browser Agent V6 on ${process.env.PORT||3000}`));
