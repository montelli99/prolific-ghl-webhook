'use strict';
function createCampaignScanner({store,request,now=()=>new Date().toISOString()}){
  async function advance(campaignId,notBefore){
    let scan=await store.get(campaignId);
    if(!scan||(scan.complete&&Date.parse(scan.startedAt)<Date.parse(notBefore)))
      scan=await store.begin(campaignId,{campaignId,startedAt:now(),page:0,ids:[],complete:false});
    if(scan.complete)return {...scan,presentIds:new Set(scan.ids)};
    if(scan.page>=100)throw Error('CAMPAIGN_SCAN_PAGE_CAP');
    const response=await request('GET',Number(campaignId),undefined,scan.page);
    if(!response.ok)return {complete:false,error:'CAMPAIGN_SCAN_HTTP_'+response.status,retry_at:response.retry_at};
    const data=response.data;
    const rows=Array.isArray(data?.data)?data.data:data?.data?.contacts||data?.contacts;
    if(!Array.isArray(rows)||rows.some(x=>!Number.isSafeInteger(Number(x.id))||Number(x.id)<=0))throw Error('CAMPAIGN_SCAN_SHAPE_INVALID');
    const next={...scan,ids:[...new Set([...scan.ids,...rows.map(x=>String(x.id))])],page:scan.page+1,complete:rows.length<50};
    await store.set(campaignId,next);
    return {...next,presentIds:new Set(next.ids)};
  }
  return {advance};
}
module.exports={createCampaignScanner};
