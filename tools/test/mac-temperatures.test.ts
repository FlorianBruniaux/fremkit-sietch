import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const now=1800000000000
function load(){
 const html=readFileSync(new URL('../../widgets/mac-temperatures/index.html',import.meta.url),'utf8'),elements=new Map<string,any>();let receive:any,tick:any,locale:any,clock=now
 const api={locale:'fr',t:(l:any,p:any={})=>l[api.locale].replace(/\{(\w+)\}/g,(_:string,k:string)=>String(p[k])),whenReady:(fn:any)=>fn(),subscribe:(channel:string,fn:any)=>{expect(channel).toBe('system');receive=fn},onLocale:(fn:any)=>{locale=fn}}
 runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],{Fremkit:api,document:{documentElement:{lang:'en'},getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id)}},Date:class extends Date{static now(){return clock}},Intl,setInterval:(fn:any)=>{tick=fn}})
 return {elements,update:(data:any)=>receive(data),advance:(ms:number)=>{clock+=ms;tick()},language:(lang:string)=>{api.locale=lang;locale()}}
}
const sample=(cpuCelsius:any=67.5,gpuCelsius:any=70.7)=>({thermal:{cpuCelsius,gpuCelsius,updatedAt:now,source:'macmon',error:null}})
describe('Mac temperature display',()=>{
 it('shows measured Celsius averages and updates decimal separators with locale',()=>{const w=load();w.update(sample());expect(w.elements.get('cpu').textContent).toBe('67,5');expect(w.elements.get('gpu').textContent).toBe('70,7');expect(w.elements.get('status').textContent).toContain('Moyennes des capteurs');w.language('en');expect(w.elements.get('cpu').textContent).toBe('67.5')})
 it('expires a reading even if the server stops publishing',()=>{const w=load();w.update(sample());w.advance(30001);expect(w.elements.get('cpu').textContent).toBe('?');expect(w.elements.get('gpu').textContent).toBe('?');expect(w.elements.get('status').textContent).toBe('Mesure ancienne')})
 it.each([null,0,-1,NaN,Infinity,150,'70'])('keeps invalid or missing CPU readings explicit: %s',value=>{const w=load();w.update(sample(value));expect(w.elements.get('cpu').textContent).toBe('?');expect(w.elements.get('gpu').textContent).toBe('70,7')})
 it.each(['unconfigured','offline','invalid','unsupported'])('removes previous values on %s',error=>{const w=load();w.update(sample());w.update({thermal:{...sample().thermal,error}});expect(w.elements.get('cpu').textContent).toBe('?')})
 it('does not keep old readings when the system provider fails',()=>{const w=load();w.update({...sample(),error:'offline'});expect(w.elements.get('cpu').textContent).toBe('?');expect(w.elements.get('status').textContent).toBe('Capteurs indisponibles')})
})
