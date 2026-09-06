import crypto from "node:crypto";
import type {Page} from "playwright";

export type TestIdentity={
 email:string;
 firstName:string;
 lastName:string;
 fullName:string;
 username:string;
 password:string;
 phone:string;
 birthDate:string;
 createdAt:string;
};

const FIRST_NAMES=["Ayan","Hamza","Ali","Hassan","Zain","Saad","Omar","Rayyan","Usman","Daniyal"];
const LAST_NAMES=["Khan","Ahmed","Malik","Raza","Ali","Sheikh","Iqbal","Shah","Mirza","Siddiqui"];
const pick=<T>(arr:T[])=>arr[crypto.randomInt(arr.length)];
const digits=(n:number)=>Array.from({length:n},()=>crypto.randomInt(10)).join("");

export function makeTestIdentity(email:string):TestIdentity{
 const firstName=pick(FIRST_NAMES),lastName=pick(LAST_NAMES);
 const stem=(email.split("@")[0]||`${firstName}${lastName}`).replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,14)||"tester";
 const username=`${stem}${digits(4)}`.slice(0,20);
 const password=`T!${crypto.randomBytes(8).toString("base64url")}9a`;
 const year=1990+crypto.randomInt(15),month=String(1+crypto.randomInt(12)).padStart(2,"0"),day=String(1+crypto.randomInt(28)).padStart(2,"0");
 return {email,firstName,lastName,fullName:`${firstName} ${lastName}`,username,password,phone:`0300${digits(7)}`,birthDate:`${year}-${month}-${day}`,createdAt:new Date().toISOString()};
}

export function nextUsername(identity:TestIdentity){
 const base=identity.username.replace(/\d+$/g,"").slice(0,14)||"tester";
 identity.username=`${base}${digits(5)}`.slice(0,20);
 return identity.username;
}

function authorizedHost(hostname:string){
 const allow=(process.env.ALLOWED_DOMAINS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 return allow.length>0&&allow.some(d=>hostname===d||hostname.endsWith(`.${d}`));
}

export async function prefillAuthorizedForm(page:Page,identity:TestIdentity){
 const host=new URL(page.url()).hostname.toLowerCase();
 if(!authorizedHost(host))return {filled:0,skipped:"ALLOWED_DOMAINS is required for smart form filling"};
 const values={email:identity.email,firstname:identity.firstName,lastname:identity.lastName,fullname:identity.fullName,username:identity.username,password:identity.password,phone:identity.phone,birthdate:identity.birthDate};
 const filled=await page.locator('input:not([type="hidden"]),textarea').evaluateAll((nodes:any[],v:any)=>{
  let count=0;
  const classify=(e:any)=>{
   const hint=[e.name,e.id,e.type,e.placeholder,e.autocomplete,e.getAttribute("aria-label"),...(e.labels?Array.from(e.labels).map((x:any)=>x.innerText):[])].filter(Boolean).join(" ").toLowerCase();
   if(/confirm.*pass|repeat.*pass|password.*confirm/.test(hint))return "password";
   if(/email|e-mail/.test(hint)||e.type==="email")return "email";
   if(/first.*name|given.*name|fname/.test(hint))return "firstname";
   if(/last.*name|family.*name|surname|lname/.test(hint))return "lastname";
   if(/full.*name|display.*name|your.*name/.test(hint))return "fullname";
   if(/user.*name|login.*name|handle/.test(hint))return "username";
   if(/pass(word)?/.test(hint)||e.type==="password")return "password";
   if(/phone|mobile|tel/.test(hint)||e.type==="tel")return "phone";
   if(/birth|dob|date.*birth/.test(hint)||e.type==="date")return "birthdate";
   return null;
  };
  for(const e of nodes){if(e.disabled||e.readOnly||String(e.value||"").trim())continue;const key=classify(e);if(!key)continue;const value=v[key];if(!value)continue;e.focus();e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));count++;}
  return count;
 },values);
 return {filled};
}
