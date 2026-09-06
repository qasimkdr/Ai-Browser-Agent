import type {Page} from "playwright";
import type {PageSnapshot} from "./types.js";
export async function observe(page:Page):Promise<PageSnapshot>{
 const title=await page.title().catch(()=>"");
 const data=await page.evaluate(()=>{
  const norm=(s:any)=>String(s||"").replace(/\s+/g," ").trim().slice(0,500);
  const visible=(e:Element)=>{const r=(e as HTMLElement).getBoundingClientRect();const st=getComputedStyle(e as HTMLElement);return r.width>0&&r.height>0&&st.visibility!=="hidden"&&st.display!=="none"};
  const nodes=Array.from(document.querySelectorAll('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')).filter(visible).slice(0,250);
  const elements=nodes.map((el:any,i)=>{
   const id=`e${i+1}`;el.setAttribute("data-agent-id",id);
   const labels=el.labels?Array.from(el.labels).map((x:any)=>x.innerText).join(" "):"";
   return {id,tag:el.tagName.toLowerCase(),role:el.getAttribute("role")||undefined,type:el.type||undefined,name:el.name||undefined,label:norm(labels||el.getAttribute("aria-label")),text:norm(el.innerText||el.textContent),placeholder:el.placeholder||undefined,value:(el.type==="password"?"[REDACTED]":norm(el.value))||undefined,checked:typeof el.checked==="boolean"?el.checked:undefined,disabled:!!el.disabled,href:el.href||undefined};
  });
  const errors=Array.from(document.querySelectorAll('[role="alert"],.error,.errors,.invalid-feedback,[aria-invalid="true"]')).filter(visible).map((e:any)=>norm(e.innerText||e.textContent)).filter(Boolean).slice(0,20);
  const dialogs=Array.from(document.querySelectorAll('[role="dialog"],dialog')).filter(visible).map((e:any)=>norm(e.innerText||e.textContent)).filter(Boolean).slice(0,10);
  return {text:norm(document.body?.innerText||"").slice(0,18000),elements,errors,dialogs};
 });
 return {url:page.url(),title,text:data.text,errors:data.errors,dialogs:data.dialogs,elements:data.elements,capturedAt:new Date().toISOString()};
}
