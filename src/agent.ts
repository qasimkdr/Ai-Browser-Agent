import {GoogleGenerativeAI} from "@google/generative-ai";
import {z} from "zod";
import type {Memory,PageSnapshot,PlanStep} from "./types.js";
const Action=z.object({type:z.enum(["click","type","select","check","press_key","hover","go_back","go_forward","reload","wait","scroll","observe","done","pause"]),elementId:z.string().optional(),target:z.string().optional(),text:z.string().optional(),value:z.string().optional(),key:z.string().optional(),ms:z.number().int().min(100).max(30000).optional(),direction:z.enum(["up","down"]).optional(),amount:z.number().int().min(100).max(2000).optional(),reason:z.string().optional(),confidence:z.number().min(0).max(1).default(.7)});
export type AgentAction=z.infer<typeof Action>;
function model(){const key=process.env.GEMINI_API_KEY;if(!key)throw new Error("GEMINI_API_KEY is missing");return new GoogleGenerativeAI(key).getGenerativeModel({model:process.env.GEMINI_MODEL||"gemini-2.5-flash"})}
function clean(s:string){return s.trim().replace(/^```json\s*/i,"").replace(/```$/,"" ).trim()}
export async function makePlan(goal:string,s:PageSnapshot):Promise<PlanStep[]>{
 const p=`You plan an authorized browser workflow. Goal: ${goal}\nURL:${s.url}\nCreate 3-10 concise normal UI steps. Do not plan CAPTCHA/anti-bot/access-control bypass. Return ONLY JSON array of strings.`;
 try{const r=await model().generateContent(p);const arr=JSON.parse(clean(r.response.text()));return arr.slice(0,10).map((title:string,i:number)=>({id:`p${i+1}`,title,status:i===0?"active":"pending"}))}catch{return [{id:"p1",title:"Inspect current page",status:"active"},{id:"p2",title:"Complete the authorized workflow",status:"pending"},{id:"p3",title:"Verify success",status:"pending"}]}
}
export async function decide(s:PageSnapshot,shot:string,goal:string,m:Memory,p:PlanStep[],recovery?:string){
 const prompt=`You are an authorized browser UI agent. Choose ONE next normal UI action. Never bypass CAPTCHA, anti-bot, identity, 2FA, paywalls, or access controls; pause for manual handling. Prefer elementId from the structured elements.\nGOAL:${goal}\nMEMORY:${JSON.stringify(m)}\nPLAN:${JSON.stringify(p)}\nRECOVERY:${recovery||"none"}\nPAGE:${JSON.stringify({...s,text:s.text.slice(0,12000)})}\nReturn ONLY JSON: {"type":"click|type|select|check|press_key|hover|go_back|go_forward|reload|wait|scroll|observe|done|pause","elementId":"e1 optional","target":"optional","text":"optional","value":"optional","key":"optional","ms":1000,"direction":"down","amount":600,"reason":"short reason","confidence":0.0}`;
 const r=await model().generateContent([{text:prompt},{inlineData:{mimeType:"image/png",data:shot}}]);return Action.parse(JSON.parse(clean(r.response.text())));
}
