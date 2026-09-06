import type {Page,Locator} from "playwright";
import type {AgentAction} from "./agent.js";
async function resolver(page:Page,a:AgentAction):Promise<Locator>{
 if(a.elementId){const x=page.locator(`[data-agent-id="${a.elementId}"]`).first();if(await x.count())return x}
 const t=a.target||""; if(!t) throw new Error("Action has no target");
 const candidates=[page.getByRole("button",{name:t,exact:false}).first(),page.getByLabel(t,{exact:false}).first(),page.getByPlaceholder(t,{exact:false}).first(),page.getByText(t,{exact:false}).first(),page.locator(`[name="${t.replace(/["\\]/g,"\\$&")}"]`).first()];
 for(const x of candidates) if(await x.count().catch(()=>0)) return x; throw new Error(`Could not resolve target: ${t}`);
}
export async function perform(page:Page,a:AgentAction){
 switch(a.type){
  case"click":return (await resolver(page,a)).click({timeout:10000}); case"type":return (await resolver(page,a)).fill(a.text||"",{timeout:10000}); case"select":return (await resolver(page,a)).selectOption(a.value||""); case"check":return (await resolver(page,a)).check(); case"press_key":return a.elementId?(await resolver(page,a)).press(a.key||"Enter"):page.keyboard.press(a.key||"Enter"); case"hover":return (await resolver(page,a)).hover(); case"go_back":return page.goBack(); case"go_forward":return page.goForward(); case"reload":return page.reload(); case"wait":return page.waitForTimeout(a.ms||1000); case"scroll":return page.mouse.wheel(0,a.direction==="up"?-(a.amount||600):(a.amount||600)); case"observe":return; default:return;
 }
}
