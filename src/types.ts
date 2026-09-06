export type JobState="queued"|"starting"|"running"|"paused"|"completed"|"failed"|"stopped";
export type Job={jobId:string;status:JobState;statusText:string;url:string;goal:string;count:number;currentAccount:number;successCount:number;failedCount:number;createdAt:string;updatedAt:string;showBrowser:boolean;stopped:boolean;paused:boolean;error?:string};
export type Memory={jobId:string;accountNumber:number;stage:string;completed:string[];remaining:string[];failedActions:string[];lastAction?:string;lastError?:string;loopCount:number;updatedAt:string};
export type PageElement={id:string;tag:string;role?:string;type?:string;name?:string;label?:string;text?:string;placeholder?:string;value?:string;checked?:boolean;disabled?:boolean;href?:string};
export type PageSnapshot={url:string;title:string;text:string;errors:string[];dialogs:string[];elements:PageElement[];capturedAt:string};
export type PlanStep={id:string;title:string;status:"pending"|"active"|"done"|"failed"};
