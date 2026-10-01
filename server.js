const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const{PORT=3000,ADMIN_PASSWORD='change-me',OWNER_WHATSAPP='',WA_TOKEN='',WA_PHONE_ID='',CALLMEBOT_KEY='',DATA_DIR=path.join(__dirname,'data')}=process.env;
const DB=path.join(DATA_DIR,'db.json'),UP=path.join(DATA_DIR,'uploads');
fs.mkdirSync(UP,{recursive:true});
const COUPONS={WELCOME10:{pct:10},BAKESTOO100:{flat:100,min:999}};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
const seed=()=>({
 products:[['Bakestoo Classic','Namkeen • Biscuits • Frooti • Sweet',399,'box'],['Bakestoo Celebration','Namkeen • Biscuits • Drink • Sweet • Chocolate',699,'box'],['Bakestoo Grand','Savouries • Cookies • Juice • Sweets • Dry-fruit bite • Chocolates',999,'box'],
 ['Namkeen','Classic savoury snack',99],['Biscuits','Assorted packet',89],['Frooti','Refreshing soft drink',40],['Sweet','Assorted sweet',129],['Chocolate','Chocolate treat',99],['Cookies','Premium cookies',149],['Juice','Fruit juice',80],['Dry Fruit Bite','Nut & fruit treat',179],['Makhana','Roasted foxnuts',129],['Chips / Wafers','Crispy snack',50],['Mathri / Savoury','Tea-time crunch',110],['Mini Cake','Celebration add-on',299]]
  .map(([name,desc,price,type],i)=>({id:'p'+(i+1),name,desc,price,type:type||'treat',img:''})),
 gallery:['Beautifully packed and such a thoughtful gifting experience.','Everything felt fresh, elegant and perfectly put together.','The perfect little box for making someone\'s day special.'].map((text,i)=>({id:'g'+i,cat:'reviews',title:'Customer review',text,img:''})),
 orders:[]});
let db;try{db=JSON.parse(fs.readFileSync(DB))}catch{db=seed();save()}

const body=req=>new Promise((ok,no)=>{let b='';req.on('data',c=>{b+=c;if(b.length>6e6){no('Too large');req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch{no('Bad request')}})});
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj))};
const isAdmin=req=>{const a=Buffer.from(String(req.headers['x-admin']||'')),b=Buffer.from(ADMIN_PASSWORD);return a.length===b.length&&crypto.timingSafeEqual(a,b)};

/* prices are always recomputed here — the browser's prices are never trusted */
function price(it){const find=id=>db.products.find(x=>x.id===id);
 if(Array.isArray(it.items)){let t=0;const d=[];for(const[id,q]of it.items){const x=find(id);if(!x||!Number.isInteger(q)||q<1||q>50)return;t+=x.price*q;d.push(q+'× '+x.name)}return d.length?{name:'Custom Box',detail:d.join(', '),price:t}:undefined}
 const x=find(it.id);return x&&{name:x.name,detail:x.desc,price:x.price}}

async function order(b){const c=b.customer||{},cl=s=>String(s||'').trim().slice(0,300);
 const cu={name:cl(c.name),phone:cl(c.phone),address:cl(c.address),city:cl(c.city),pin:cl(c.pin),note:cl(c.note)};
 if(cu.name.length<2||!/^(\+?91)?[6-9]\d{9}$/.test(cu.phone.replace(/[\s-]/g,''))||!/^[1-9]\d{5}$/.test(cu.pin)||cu.address.length<9)throw'Please check your delivery details.';
 const items=[];let sub=0;
 for(const it of Array.isArray(b.items)?b.items:[]){const q=it.qty,p=price(it);if(!p||!Number.isInteger(q)||q<1||q>50)throw'An item in your cart is no longer available. Please refresh.';items.push({...p,qty:q});sub+=p.price*q}
 if(!items.length)throw'Your cart is empty.';
 const k=COUPONS[b.coupon],disc=k&&(!k.min||sub>=k.min)?(k.pct?Math.round(sub*k.pct/100):k.flat):0,ship=sub<999?79:0;
 const pay=['UPI','Cash on Delivery','Payment Link'].includes(b.payment)?b.payment:'UPI';
 const o={id:'BAKE'+Date.now().toString().slice(-8),at:new Date().toISOString(),customer:cu,items,sub,ship,disc,coupon:disc?b.coupon:'',total:Math.max(0,sub+ship-disc),pay,paid:pay==='Cash on Delivery'?'Pay on delivery':'Paid (demo)',status:'New'};
 db.orders.unshift(o);save();
 notify(o).catch(e=>console.log('WhatsApp alert failed:',e.message));
 return{id:o.id,total:o.total}}

/* instant WhatsApp alert to the owner */
async function notify(o){const c=o.customer;
 const text=`🧁 New Bakestoo order ${o.id}\n${c.name} · ${c.phone}\n${c.address}, ${c.city} ${c.pin}\n\n${o.items.map(i=>`• ${i.qty}× ${i.name} (${i.detail})`).join('\n')}\n\nTotal ₹${o.total} · ${o.pay} (${o.paid})${c.note?'\nNote: '+c.note:''}`;
 if(CALLMEBOT_KEY){await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+'+OWNER_WHATSAPP)}&apikey=${CALLMEBOT_KEY}&text=${encodeURIComponent(text)}`)}
 else if(WA_TOKEN&&WA_PHONE_ID){const r=await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:OWNER_WHATSAPP,type:'text',text:{body:text}})});if(!r.ok)throw new Error(await r.text())}
 else console.log('[WhatsApp not configured — order alert below]\n'+text)}

const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname,m=req.method;
 try{
  if(p==='/api/store'&&m==='GET')return send(res,200,{products:db.products,gallery:db.gallery,coupons:COUPONS});
  if(p==='/api/orders'&&m==='POST')return send(res,200,await order(await body(req)));
  if(p.startsWith('/api/admin')){
   if(!isAdmin(req))return send(res,401,{error:'Wrong password'});
   const[,,,k,id]=p.split('/');
   if(m==='GET'&&!k)return send(res,200,db);
   if(m==='PUT'&&(k==='products'||k==='gallery')){const b=await body(req);if(!Array.isArray(b))throw'Bad data';db[k]=b;save();return send(res,200,{ok:1})}
   if(m==='PATCH'&&k==='orders'){const b=await body(req),o=db.orders.find(x=>x.id===id);if(o&&typeof b.status==='string'){o.status=b.status;save()}return send(res,200,{ok:1})}
   if(m==='POST'&&k==='upload'){const b=await body(req),x=/^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(b.data||'');if(!x)throw'Bad image';
    const n=crypto.randomBytes(8).toString('hex')+'.'+(x[1]==='jpeg'?'jpg':x[1]);fs.writeFileSync(path.join(UP,n),Buffer.from(x[2],'base64'));return send(res,200,{url:'/uploads/'+n})}
   return send(res,404,{error:'Not found'})}
  const f=p.startsWith('/uploads/')?path.join(UP,path.basename(p)):path.join(__dirname,'public',p==='/'?'index.html':p==='/admin'?'admin.html':path.basename(p));
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}
   res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':p.startsWith('/uploads/')?'public,max-age=31536000':'no-cache'});res.end(d)})
 }catch(e){send(res,typeof e==='string'?400:500,{error:typeof e==='string'?e:'Server error'})}
}).listen(PORT,()=>console.log('Bakestoo running → http://localhost:'+PORT+'  (admin: /admin)'));
