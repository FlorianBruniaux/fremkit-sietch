import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {runInNewContext,Script} from 'node:vm'
import {randomUUID,webcrypto} from 'node:crypto'
function load(){
 const html=readFileSync(new URL('../../widgets/youtube-control/index.html',import.meta.url),'utf8'),elements=new Map<string,any>(),commands:any[]=[],handlers:Record<string,any>={};let subscribe:any,tick:any,language:any,now=1800000000000
 const element=(id:string)=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,value:0,srcObject:null,disabled:false,addEventListener:(event:string,fn:any)=>{handlers[id+':'+event]=fn},getAttribute:(key:string)=>key==='data-action'?id:null});return elements.get(id)}
 const buttons=['toggle','mute','show','stop'].map(element)
 const api={locale:'fr',t:(l:any)=>l[api.locale],whenReady:(fn:any)=>fn(),onLocale:(fn:any)=>{language=fn},subscribe:(_:string,fn:any)=>{subscribe=fn},sendCommand:(...args:any[])=>{commands.push(args);return Promise.resolve({ok:true,code:'123456',expiresAt:now+90000})}}
 runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],{Fremkit:api,document:{documentElement:{lang:'en'},getElementById:element,querySelectorAll:()=>buttons},window:{addEventListener(){}},crypto:{randomUUID,getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},Date:class extends Date{static now(){return now}},setInterval:(fn:any)=>{tick=fn},setTimeout,clearTimeout,Uint8Array,Intl})
 return {commands,elements,update:(data:any)=>subscribe(data),click:(id:string)=>handlers[id+':click']?.(),tick:()=>tick(),advance:(ms:number)=>{now+=ms;tick()},language:(lang:string)=>{api.locale=lang;language()}}
}
describe('YouTube page controls and empty state',()=>{
 it('guides the user to share a chosen Chrome tab without creating another YouTube player',()=>{const w=load();expect(w.elements.get('emptyText').textContent).toContain('Chrome');expect(w.elements.get('toggle').disabled).toBe(true);expect(w.commands).toEqual([])})
 it('generates an expiring pairing code only after a user action',async()=>{const w=load();await w.click('pair');expect(w.commands).toEqual([['youtube','pair',{}]]);expect(w.elements.get('code').textContent).toBe('123456');expect(w.elements.get('code').hidden).toBe(false);w.advance(90001);expect(w.elements.get('code').hidden).toBe(true)})
 it('disables controls and discards a prior image when metadata expires',()=>{const w=load();w.update({state:'sharing',sessionId:'00000000-0000-4000-8000-000000000001',updatedAt:1800000000000,meta:{title:'Example',currentTime:12,duration:100,paused:false,muted:false,volume:.5,crop:null},receivers:[]});expect(w.elements.get('title').textContent).toBe('Example');expect(w.elements.get('toggle').disabled).toBe(false);w.advance(10001);expect(w.elements.get('toggle').disabled).toBe(true);expect(w.elements.get('video').srcObject).toBeNull();expect(w.elements.get('title').textContent).toBe('')})
 it('targets the captured session ID and preserves the title as text',async()=>{const w=load(),id='00000000-0000-4000-8000-000000000001';w.update({state:'sharing',sessionId:id,updatedAt:1800000000000,meta:{title:'<img src=x>',currentTime:12,duration:100,paused:true,muted:false,volume:.5,crop:null},receivers:[]});w.click('toggle');await Promise.resolve();expect(w.commands).toEqual([['youtube','control',{sessionId:id,action:'toggle'}]]);expect(w.elements.get('title').textContent).toBe('<img src=x>');w.language('en');expect(w.elements.get('toggle').textContent).toBe('▶ Play')})
 it('does not send commands for stale or unshared sessions',()=>{const w=load();w.click('toggle');w.update({state:'idle',updatedAt:1800000000000,meta:null});w.click('show');expect(w.commands).toEqual([])})
})
describe('Companion extension packaging',()=>{
 it('parses each delivered script and limits permissions to temporary tab access plus the local bridge',()=>{
  const folder=new URL('../../extensions/youtube-xeneon/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',folder),'utf8'))
  expect(manifest.permissions).toEqual(['activeTab','scripting','tabCapture','offscreen','storage']);expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*'])
  for(const file of ['worker.js','popup.js','offscreen.js'])expect(()=>new Script(readFileSync(new URL(file,folder),'utf8'))).not.toThrow()
  const sender=readFileSync(new URL('offscreen.js',folder),'utf8');expect(sender).toContain('audio:false');expect(sender).toContain('iceServers:[]');expect(sender).not.toMatch(/stun:|turn:/)
 })

 it('controls the visible Short instead of a retained offscreen player',async()=>{
  const script=readFileSync(new URL('../../extensions/youtube-xeneon/worker.js',import.meta.url),'utf8')
  const rect=(top:number)=>({x:0,y:top,left:0,top,right:500,bottom:top+500,width:500,height:500})
  const first={paused:true,currentTime:1,duration:100,muted:false,volume:1,getBoundingClientRect:()=>rect(-900),closest:()=>null,play(){throw Error('wrong player')},pause(){throw Error('wrong player')}}
  const active={paused:true,currentTime:2,duration:100,muted:false,volume:1,getBoundingClientRect:()=>rect(100),closest:()=>({}),play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true}}
  const chrome={runtime:{onMessage:{addListener() {}}},tabs:{get:async()=>({url:'https://www.youtube.com/shorts/abcdefghijk'}),onRemoved:{addListener(){}},onUpdated:{addListener(){}}},scripting:{executeScript:async({func,args}:any)=>[{result:func(...args)}]}}
  const context={chrome,URL,document:{querySelectorAll:()=>[first,active],title:'Short - YouTube'},location:{pathname:'/shorts/abcdefghijk',href:'https://www.youtube.com/shorts/abcdefghijk'},innerWidth:1000,innerHeight:1000}
  runInNewContext(script,context)
  const inspect=(context as any).inspect
  const result=await inspect(1,{action:'toggle'})
  expect(first.paused).toBe(true)
  expect(active.paused).toBe(false)
  expect(result.currentTime).toBe(2)
 })
 it('chooses the nearest visible Short when no renderer is marked active',async()=>{
  const script=readFileSync(new URL('../../extensions/youtube-xeneon/worker.js',import.meta.url),'utf8')
  const video=(top:number,time:number)=>({paused:true,currentTime:time,duration:100,muted:false,volume:1,getBoundingClientRect:()=>({x:0,y:top,left:0,top,right:500,bottom:top+500,width:500,height:500}),closest:()=>null,play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true}})
  const adjacent=video(-100,1),centered=video(250,2)
  const chrome={runtime:{onMessage:{addListener() {}}},tabs:{get:async()=>({url:'https://www.youtube.com/shorts/abcdefghijk'}),onRemoved:{addListener(){}},onUpdated:{addListener(){}}},scripting:{executeScript:async({func,args}:any)=>[{result:func(...args)}]}}
  const context={chrome,URL,document:{querySelectorAll:()=>[adjacent,centered],title:'Short - YouTube'},location:{pathname:'/shorts/abcdefghijk',href:'https://www.youtube.com/shorts/abcdefghijk'},innerWidth:1000,innerHeight:1000}
  runInNewContext(script,context)
  const result=await (context as any).inspect(1,{action:'toggle'})
  expect(adjacent.paused).toBe(true)
  expect(centered.paused).toBe(false)
  expect(result.currentTime).toBe(2)
 })
})

describe('Chrome offscreen runtime boundary',()=>{
 it('starts video capture when chrome.runtime is the only available extension API',async()=>{
  const script=readFileSync(new URL('../../extensions/youtube-xeneon/offscreen.js',import.meta.url),'utf8'),sent:any[]=[];let listener:any;
  const track={stop(){},onended:null},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video={videoWidth:1280,videoHeight:720,srcObject:null,play:async()=>{}};
  const canvas={width:1280,height:720,getContext:()=>({drawImage(){}}),captureStream:()=>stream};
  class Socket {static OPEN=1;readyState=1;onopen:any;onerror:any;onclose:any;onmessage:any;constructor(){queueMicrotask(()=>this.onopen?.())}send(value:string){sent.push(JSON.parse(value))}close(){this.readyState=3}}
  const runtime={id:'extension-test',onMessage:{addListener(fn:any){listener=fn}},sendMessage:async()=>({ok:true})};
  runInNewContext(script,{document:{getElementById:(id:string)=>id==='source'?video:canvas},chrome:{runtime},navigator:{mediaDevices:{getUserMedia:async()=>stream}},crypto:{randomUUID},WebSocket:Socket,queueMicrotask,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,Map,Math,JSON,Promise});
  const result:any=await new Promise(resolve=>listener({target:'offscreen',type:'start',tabId:1,streamId:'chosen-tab-stream',pairKey:'paired-secret',meta:{crop:null}},{id:runtime.id},resolve));
  expect(result).toEqual({ok:true});
  expect(sent[0]).toEqual({type:'hello',token:'paired-secret'});
  expect(sent[1]).toMatchObject({type:'started'});
  await new Promise(resolve=>listener({target:'offscreen',type:'stop'},{id:runtime.id},resolve));
 })
})
