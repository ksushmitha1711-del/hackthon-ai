const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000);
const API_ROOT = 'https://affiliate-api.flipkart.net/affiliate/1.0/search.json';
const cache = new Map();
const requestCounts = new Map();
const temporaryTryOnImages = new Map();
const offersCache = { value:null, expires:0 };
const categoryCache = { value:null, expires:0 };
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify(body));
}
function rateAllowed(req) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || 'unknown';
  const record = requestCounts.get(ip);
  if (!record || now - record.started > 60_000) { requestCounts.set(ip, { started:now, count:1 }); return true; }
  if (record.count >= 30) return false;
  record.count += 1;
  return true;
}
function flipkartLink(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)flipkart\.com$/i.test(url.hostname)) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}
function safeImage(images) {
  const candidates = images && typeof images === 'object' ? Object.values(images) : [];
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if (/(^|\.)(fkcdn\.com|flixcart\.com)$/i.test(url.hostname)) { url.protocol = 'https:'; return url.href; }
    } catch {}
  }
  return '';
}
function amount(obj) {
  const n = Number(obj?.amount ?? obj);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normalizeProduct(row) {
  const base = row?.productBaseInfoV1 || row?.productBaseInfo?.productAttributes || row?.productBaseInfo || {};
  const productUrl = flipkartLink(base.productUrl);
  const price = amount(base.flipkartSpecialPrice) || amount(base.sellingPrice) || amount(base.flipkartSellingPrice);
  const mrp = amount(base.maximumRetailPrice);
  if (!productUrl || !price || !base.title) return null;
  const seller = row?.productShippingInfoV1 || row?.productShippingBaseInfo || {};
  const sellerRating = Number(seller.sellerAverageRating);
  const discount = Number(base.discountPercentage);
  return {
    id: String(base.productId || ''),
    name: String(base.title),
    brand: String(base.productBrand || ''),
    description: String(base.productDescription || ''),
    image: safeImage(base.imageUrls),
    price,
    mrp,
    discount: Number.isFinite(discount) && discount > 0 ? discount : (mrp && mrp > price ? Math.round((1-price/mrp)*100) : null),
    inStock: base.inStock !== false,
    productUrl,
    sellerName: String(seller.sellerName || ''),
    sellerRating: Number.isFinite(sellerRating) && sellerRating > 0 ? sellerRating : null,
    sellerRatingCount: Number(seller.sellerNoOfRatings) || 0,
    marketplace: 'Flipkart',
    offers: Array.isArray(base.offers) ? base.offers.map(offer => typeof offer === 'string' ? offer : String(offer?.title || offer?.description || '')).filter(Boolean) : [],
    source: 'Flipkart Affiliate API'
  };
}
async function flipkartSearch(query) {
  const affiliateId = process.env.FLIPKART_AFFILIATE_ID;
  const affiliateToken = process.env.FLIPKART_AFFILIATE_TOKEN;
  if (!affiliateId || !affiliateToken) return { status:503, body:{ error:'Flipkart API is not configured. Add your Affiliate ID and API token to the server .env file.' } };
  const budgetMatch = query.match(/(?:under|below|less than)\s*₹?\s*([\d,]+)/i);
  const maxPrice = budgetMatch ? Number(budgetMatch[1].replace(/,/g,'')) : null;
  const affiliateQuery = query.replace(/\b(?:products?|items?)\b/gi,' ').replace(/(?:under|below|less than)\s*₹?\s*[\d,]+/gi,' ').replace(/\s+/g,' ').trim() || 'popular products';
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return { status:200, body:cached.body };
  const url = new URL(API_ROOT);
  url.searchParams.set('query', affiliateQuery);
  url.searchParams.set('resultCount', '10');
  try {
    const response = await fetch(url, { headers:{ 'Fk-Affiliate-Id':affiliateId, 'Fk-Affiliate-Token':affiliateToken, accept:'application/json' }, signal:AbortSignal.timeout(12_000) });
    if (!response.ok) return { status:502, body:{ error:`Flipkart API returned HTTP ${response.status}. Check your Affiliate account access and credentials.` } };
    const data = await response.json();
    let items = (data.productInfoList || []).map(normalizeProduct).filter(Boolean);
    if (maxPrice) items = items.filter(item => item.price <= maxPrice);
    const body = { marketplace:'Flipkart', query, count:items.length, products:items, fetchedAt:new Date().toISOString() };
    cache.set(key, { body, expires:Date.now()+5*60_000 });
    return { status:200, body };
  } catch (error) {
    return { status:502, body:{ error:error.name==='TimeoutError'?'Flipkart search timed out. Please try again.':'Could not reach the Flipkart Affiliate API.' } };
  }
}
function normalizeOffer(offer) {
  const url=flipkartLink(offer?.url);
  if(!url||offer?.availability==='OOS')return null;
  const image=safeImage(Array.isArray(offer.imageUrls)?offer.imageUrls.map(x=>x?.url):[]);
  const now=Date.now(),start=Number(offer.startTime)||0,end=Number(offer.endTime)||0;
  if(start&&start>now)return null;
  if(end&&end<now)return null;
  return {title:String(offer.title||'Flipkart offer'),description:String(offer.description||''),category:String(offer.category||''),url,image,endTime:end?new Date(end).toISOString():null,marketplace:'Flipkart'};
}
async function flipkartOffers() {
  if(!process.env.FLIPKART_AFFILIATE_ID||!process.env.FLIPKART_AFFILIATE_TOKEN)return {status:503,body:{error:'Flipkart API is not configured. Add your Affiliate ID and API token to the server .env file.'}};
  if(offersCache.value&&offersCache.expires>Date.now())return {status:200,body:offersCache.value};
  const headers={'Fk-Affiliate-Id':process.env.FLIPKART_AFFILIATE_ID,'Fk-Affiliate-Token':process.env.FLIPKART_AFFILIATE_TOKEN,accept:'application/json'};
  try {
    const [allRes,dotdRes]=await Promise.all([
      fetch('https://affiliate-api.flipkart.net/affiliate/offers/v1/all/json',{headers,signal:AbortSignal.timeout(12000)}),
      fetch('https://affiliate-api.flipkart.net/affiliate/offers/v1/dotd/json',{headers,signal:AbortSignal.timeout(12000)})
    ]);
    if(!allRes.ok||!dotdRes.ok)return {status:502,body:{error:`Flipkart Offers API returned HTTP ${!allRes.ok?allRes.status:dotdRes.status}. Check your Affiliate access.`}};
    const [allData,dotdData]=await Promise.all([allRes.json(),dotdRes.json()]);
    const body={offers:(allData.allOffersList||[]).map(normalizeOffer).filter(Boolean),deals:(dotdData.dotdList||[]).map(normalizeOffer).filter(Boolean),fetchedAt:new Date().toISOString()};
    offersCache.value=body;offersCache.expires=Date.now()+5*60_000;
    return {status:200,body};
  }catch(error){return {status:502,body:{error:error.name==='TimeoutError'?'Flipkart offers timed out. Please try again.':'Could not reach Flipkart Offers API.'}}}
}
async function fetchAffiliateJson(url) {
  const response=await fetch(url,{headers:{'Fk-Affiliate-Id':process.env.FLIPKART_AFFILIATE_ID,'Fk-Affiliate-Token':process.env.FLIPKART_AFFILIATE_TOKEN,accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Flipkart API returned HTTP ${response.status}`);
  return response.json();
}
function validAffiliateFeedUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:'&&url.hostname==='affiliate-api.flipkart.net'; }
  catch { return false; }
}
async function flipkartCategories() {
  if(!process.env.FLIPKART_AFFILIATE_ID||!process.env.FLIPKART_AFFILIATE_TOKEN)return {status:503,body:{error:'Flipkart API is not configured. Add Affiliate credentials to .env.'}};
  if(categoryCache.value&&categoryCache.expires>Date.now())return {status:200,body:{categories:categoryCache.value}};
  try {
    const directoryUrl=`https://affiliate-api.flipkart.net/affiliate/api/${encodeURIComponent(process.env.FLIPKART_AFFILIATE_ID)}.json`;
    const data=await fetchAffiliateJson(directoryUrl);
    const listings=data?.apiGroups?.affiliate?.apiListings||{};
    const categories=Object.entries(listings).map(([id,value])=>{
      const variants=value?.availableVariants||{};
      const feed=variants['v1.1.0']||variants['1.1.0']||Object.values(variants).at(-1)||{};
      const url=feed.top||feed.get;
      return validAffiliateFeedUrl(url)?{id,name:id.replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}:null;
    }).filter(Boolean);
    categoryCache.value=categories;categoryCache.expires=Date.now()+8*60*60_000;
    categoryCache.feedUrls=Object.fromEntries(Object.entries(listings).map(([id,value])=>{const variants=value?.availableVariants||{};const feed=variants['v1.1.0']||variants['1.1.0']||Object.values(variants).at(-1)||{};return [id,feed.top||feed.get]}));
    return {status:200,body:{categories}};
  } catch(error) { return {status:502,body:{error:error.message||'Could not load the Flipkart category directory.'}}; }
}
async function flipkartCategory(id) {
  if(!categoryCache.value||categoryCache.expires<Date.now()){const result=await flipkartCategories();if(result.status!==200)return result;}
  if(!/^[a-z0-9_-]{1,80}$/i.test(id))return {status:400,body:{error:'Invalid Flipkart category.'}};
  const feedUrl=categoryCache.feedUrls?.[id];
  if(!validAffiliateFeedUrl(feedUrl))return {status:404,body:{error:'Flipkart category feed was not found.'}};
  try {
    const data=await fetchAffiliateJson(feedUrl);
    const products=(data.productInfoList||[]).map(normalizeProduct).filter(Boolean).slice(0,80);
    return {status:200,body:{marketplace:'Flipkart',category:id,count:products.length,products,fetchedAt:new Date().toISOString()}};
  } catch(error) { return {status:502,body:{error:error.message||'Could not load this Flipkart category.'}}; }
}
function readJsonBody(req, maxBytes=10_000_000) {
  // Vercel's Node runtime may parse JSON bodies before invoking the function.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body))); }
    catch { return Promise.reject(new Error('Invalid request body.')); }
  }
  return new Promise((resolve,reject)=>{
    let body='',size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){reject(new Error('Photo is too large. Please try again with a smaller image.'));req.destroy();return}body+=chunk.toString('utf8')});
    req.on('end',()=>{try{resolve(JSON.parse(body||'{}'))}catch{reject(new Error('Invalid request body.'))}});
    req.on('error',reject);
  });
}
async function klingTryOn(modelImage,garmentImage,requestBase) {
  const key=process.env.KLING_API_KEY;
  if(!key)return {status:503,body:{error:'Kling try-on is not configured. Add KLING_API_KEY to the server .env file.'}};
  let publicBase;
  const configuredBase=process.env.PUBLIC_BASE_URL||(process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:requestBase||'');
  try{publicBase=new URL(configuredBase)}catch{return {status:503,body:{error:'Kling needs a public HTTPS site URL to read the temporary person photo. Set PUBLIC_BASE_URL after deploying Snap Store.'}}}
  if(publicBase.protocol!=='https:'||['localhost','127.0.0.1','::1'].includes(publicBase.hostname))return {status:503,body:{error:'Kling cannot fetch photos from localhost. Deploy Snap Store over HTTPS and set PUBLIC_BASE_URL to that public URL.'}};
  if(typeof modelImage!=='string'||modelImage.length>9_000_000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(modelImage))return {status:400,body:{error:'The camera photo is missing or too large. Please retake it.'}};
  let garment;try{garment=new URL(garmentImage)}catch{return {status:400,body:{error:'Product image URL is invalid.'}}}
  if(garment.protocol!=='https:'||garment.hostname!=='images.unsplash.com')return {status:400,body:{error:'This clothing image cannot be used for virtual try-on.'}};
  const mime=modelImage.slice(5,modelImage.indexOf(';')),bytes=Buffer.from(modelImage.slice(modelImage.indexOf(',')+1),'base64');
  if(bytes.length>6_500_000)return {status:400,body:{error:'The selected photo is too large. Please use a smaller image.'}};
  const token=crypto.randomBytes(32).toString('hex'),expires=Date.now()+10*60_000;
  temporaryTryOnImages.set(token,{mime,bytes,expires});
  const photoUrl=new URL(`/api/tryon-image/${token}`,publicBase.origin).href;
  const headers={'Authorization':`Bearer ${key}`,'Content-Type':'application/json'};
  try{
    const start=await fetch('https://api-singapore.klingai.com/solutions/virtual_try_on',{method:'POST',headers,body:JSON.stringify({contents:[{type:'product_image',url:garment.href},{type:'person_image',url:photoUrl}],settings:{keep_face:true,keep_pose:true,keep_background:true}}),signal:AbortSignal.timeout(20000)});
    const created=await start.json().catch(()=>({}));
    if(start.status===401)return {status:401,body:{error:'Kling rejected this API key. Check KLING_API_KEY in .env and restart Snap Store.'}};
    if(start.status===429)return {status:429,body:{error:created.message||'Kling declined the request because of credits or provider limits.'}};
    if(!start.ok||created.code!==0||!created.data?.task_id)return {status:502,body:{error:created.message||`Kling returned HTTP ${start.status}.`}};
    for(let attempt=0;attempt<40;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2000));
      const poll=await fetch(`https://api-singapore.klingai.com/solutions?task_ids=${encodeURIComponent(created.data.task_id)}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
      const result=await poll.json().catch(()=>({}));
      if(!poll.ok||result.code!==0)return {status:502,body:{error:result.message||`Could not check Kling try-on status (HTTP ${poll.status}).`}};
      const task=Array.isArray(result.data)?result.data[0]:null;
      if(task?.status==='succeed'){const image=task.outputs?.find(item=>item.type==='image')?.url;if(image)return {status:200,body:{image}};return {status:502,body:{error:'Kling completed without returning a try-on image.'}}}
      if(task?.status==='failed')return {status:502,body:{error:task.message||'Kling could not fit this outfit to the photo. Try a clear, front-facing image.'}};
    }
    return {status:504,body:{error:'Kling is taking longer than expected. Please try again.'}};
  }catch(error){return {status:502,body:{error:error.name==='TimeoutError'?'Kling timed out. Please try again.':'Could not connect to Kling.'}}
  }finally{setTimeout(()=>temporaryTryOnImages.delete(token),10*60_000).unref?.()}
}
async function groqShoppingChat(query,catalog) {
  const key=process.env.GROQ_API_KEY;
  if(!key)return {status:503,body:{error:'Groq is not configured. Add GROQ_API_KEY to the server .env file.'}};
  const safeCatalog=(Array.isArray(catalog)?catalog:[]).slice(0,50).map(p=>({id:Number(p.id),name:String(p.name||'').slice(0,120),brand:String(p.brand||'').slice(0,80),category:String(p.category||'').slice(0,80),price:Number(p.price),rating:Number(p.rating)})).filter(p=>Number.isInteger(p.id)&&p.name&&Number.isFinite(p.price));
  try{
    const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-20b',temperature:0.3,max_completion_tokens:450,response_format:{type:'json_object'},messages:[{role:'system',content:'You are Snap Store’s shopping assistant. Use only the products in the supplied catalog. Never invent or change a product, price, brand, or rating. Recommend at most three matching product IDs. Return one JSON object with keys message (a short helpful reply) and productIds (an array of integer IDs). If nothing matches, use an empty productIds array.'},{role:'user',content:JSON.stringify({request:String(query||'').slice(0,500),catalog:safeCatalog})}]}),signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return {status:502,body:{error:data.error?.message||data.message||`Groq returned HTTP ${response.status}.`}};
    const content=data.choices?.[0]?.message?.content;
    let answer;try{answer=JSON.parse(content)}catch{return {status:502,body:{error:'Groq returned an unreadable shopping response.'}}}
    const ids=new Set(safeCatalog.map(p=>p.id));
    const productIds=(Array.isArray(answer.productIds)?answer.productIds:[]).map(Number).filter(id=>ids.has(id)).slice(0,3);
    return {status:200,body:{message:String(answer.message||'Here are a few finds for you.').slice(0,500),productIds}};
  }catch(error){return {status:502,body:{error:error.name==='TimeoutError'?'Groq took too long to respond. Please try again.':'Could not connect to Groq.'}}}
}
async function serveStatic(urlPath, res) {
  const requested = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const resolved = path.resolve(ROOT, `.${requested}`);
  if (!resolved.startsWith(ROOT + path.sep) || !['.html','.css','.js','.svg','.webmanifest'].includes(path.extname(resolved))) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const content = await fs.promises.readFile(resolved);
    res.writeHead(200, { 'content-type':MIME[path.extname(resolved)], 'x-content-type-options':'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const tryOnImageMatch=url.pathname.match(/^\/api\/tryon-image\/([a-f0-9]{64})$/);
  if(tryOnImageMatch&&req.method==='GET'){
    const image=temporaryTryOnImages.get(tryOnImageMatch[1]);
    if(!image||image.expires<Date.now()){temporaryTryOnImages.delete(tryOnImageMatch[1]);res.writeHead(404,{'cache-control':'no-store'});res.end('Photo expired');return}
    res.writeHead(200,{'content-type':image.mime,'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff'});res.end(image.bytes);return;
  }
  if(url.pathname==='/api/virtual-try-on'&&req.method==='POST'){
    try{
      const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
      const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
      const requestBase=host?`${proto}://${host}`:'';
      const body=await readJsonBody(req);
      const result=await klingTryOn(body.modelImage,body.garmentImage,requestBase);
      send(res,result.status,result.body);
    }
    catch(error){if(!res.headersSent)send(res,400,{error:error.message||'Could not read the try-on request.'})}
    return;
  }
  if(url.pathname==='/api/assistant/chat'&&req.method==='POST'){
    if(!rateAllowed(req)){send(res,429,{error:'Too many assistant requests. Please try again shortly.'});return}
    try{const body=await readJsonBody(req,100_000);const query=String(body.query||'').trim();if(!query||query.length>500){send(res,400,{error:'Enter a shopping request under 500 characters.'});return}const result=await groqShoppingChat(query,body.catalog);send(res,result.status,result.body)}
    catch(error){if(!res.headersSent)send(res,400,{error:error.message||'Could not read the assistant request.'})}
    return;
  }
  if (url.pathname === '/api/flipkart/status' && req.method === 'GET') {
    send(res, 200, { configured:Boolean(process.env.FLIPKART_AFFILIATE_ID && process.env.FLIPKART_AFFILIATE_TOKEN) });
    return;
  }
  if (url.pathname === '/api/flipkart/search' && req.method === 'GET') {
    if (!rateAllowed(req)) { send(res, 429, { error:'Too many searches. Please wait a moment and try again.' }); return; }
    const query = String(url.searchParams.get('q') || '').trim().replace(/\s+/g,' ');
    if (query.length < 2 || query.length > 100) { send(res, 400, { error:'Enter a search between 2 and 100 characters.' }); return; }
    const result = await flipkartSearch(query);
    send(res, result.status, result.body);
    return;
  }
  if (url.pathname === '/api/flipkart/offers' && req.method === 'GET') {
    if (!rateAllowed(req)) { send(res,429,{error:'Too many requests. Please wait a moment and try again.'}); return; }
    const result=await flipkartOffers();send(res,result.status,result.body);return;
  }
  if (url.pathname === '/api/flipkart/categories' && req.method === 'GET') {
    if (!rateAllowed(req)) { send(res,429,{error:'Too many requests. Please wait a moment and try again.'}); return; }
    const result=await flipkartCategories();send(res,result.status,result.body);return;
  }
  if (url.pathname === '/api/flipkart/category' && req.method === 'GET') {
    if (!rateAllowed(req)) { send(res,429,{error:'Too many requests. Please wait a moment and try again.'}); return; }
    const result=await flipkartCategory(String(url.searchParams.get('id')||''));send(res,result.status,result.body);return;
  }
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) { send(res, 404, { error:'Not found' }); return; }
  serveStatic(url.pathname, res);
}

// Vercel invokes the exported handler as a serverless function. Keep the
// standalone HTTP server for local development.
if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, () => console.log(`Snap Store running at http://localhost:${PORT}`));
}

module.exports = handler;
