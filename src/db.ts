import fs from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import type {Job,Memory,PlanStep} from "./types.js";
fs.mkdirSync("data",{recursive:true});
const db=new DatabaseSync(path.join("data","agent-v5.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(job_id TEXT PRIMARY KEY,json TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,account_number INTEGER,kind TEXT NOT NULL,message TEXT NOT NULL,meta TEXT,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memories(job_id TEXT NOT NULL,account_number INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(job_id,account_number)); CREATE TABLE IF NOT EXISTS plans(job_id TEXT NOT NULL,account_number INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(job_id,account_number)); CREATE TABLE IF NOT EXISTS results(job_id TEXT NOT NULL,account_number INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(job_id,account_number));`);
const putJob=db.prepare(`INSERT INTO jobs(job_id,json,updated_at) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at`);
export function saveJob(j:Job){j.updatedAt=new Date().toISOString();putJob.run(j.jobId,JSON.stringify(j),j.updatedAt)}
export function getJob(id:string):Job|undefined{const r=db.prepare(`SELECT json FROM jobs WHERE job_id=?`).get(id) as any;return r?JSON.parse(r.json):undefined}
export function listJobs():Job[]{return (db.prepare(`SELECT json FROM jobs ORDER BY updated_at DESC`).all() as any[]).map(r=>JSON.parse(r.json))}
export function addEvent(jobId:string,account:number|null,kind:string,message:string,meta?:any){db.prepare(`INSERT INTO events(job_id,account_number,kind,message,meta,created_at) VALUES(?,?,?,?,?,?)`).run(jobId,account,kind,message,meta?JSON.stringify(meta):null,new Date().toISOString())}
export function listEvents(jobId:string,limit=300){return (db.prepare(`SELECT id,job_id as jobId,account_number as accountNumber,kind,message,meta,created_at as createdAt FROM events WHERE job_id=? ORDER BY id DESC LIMIT ?`).all(jobId,limit) as any[]).reverse().map(x=>({...x,meta:x.meta?JSON.parse(x.meta):undefined}))}
export function saveMemory(m:Memory){db.prepare(`INSERT INTO memories(job_id,account_number,json) VALUES(?,?,?) ON CONFLICT(job_id,account_number) DO UPDATE SET json=excluded.json`).run(m.jobId,m.accountNumber,JSON.stringify(m))}
export function getMemory(jobId:string,a:number):Memory|undefined{const r=db.prepare(`SELECT json FROM memories WHERE job_id=? AND account_number=?`).get(jobId,a) as any;return r?JSON.parse(r.json):undefined}
export function savePlan(jobId:string,a:number,p:PlanStep[]){db.prepare(`INSERT INTO plans(job_id,account_number,json) VALUES(?,?,?) ON CONFLICT(job_id,account_number) DO UPDATE SET json=excluded.json`).run(jobId,a,JSON.stringify(p))}
export function getPlan(jobId:string,a:number):PlanStep[]{const r=db.prepare(`SELECT json FROM plans WHERE job_id=? AND account_number=?`).get(jobId,a) as any;return r?JSON.parse(r.json):[]}
export function saveResult(jobId:string,a:number,r:any){db.prepare(`INSERT INTO results(job_id,account_number,json) VALUES(?,?,?) ON CONFLICT(job_id,account_number) DO UPDATE SET json=excluded.json`).run(jobId,a,JSON.stringify(r))}
export function listResults(jobId:string){return (db.prepare(`SELECT json FROM results WHERE job_id=? ORDER BY account_number`).all(jobId) as any[]).map(x=>JSON.parse(x.json))}
export function restoreInterruptedJobs(){for(const j of listJobs()){if(["starting","running"].includes(j.status)){j.status="paused";j.paused=true;j.statusText="Paused after server restart — resume the job";saveJob(j)}}}
