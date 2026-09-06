import crypto from "node:crypto";
export class Watchdog{private last="";private repeats=0;check(url:string,text:string,action:string){const h=crypto.createHash("sha1").update(url+"|"+text.slice(0,4000)+"|"+action).digest("hex");this.repeats=h===this.last?this.repeats+1:0;this.last=h;return this.repeats>=2}reset(){this.last="";this.repeats=0}}
