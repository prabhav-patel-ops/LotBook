import { MAX_FILE_BYTES, MAX_ROWS, normalizeDate } from './importer.js';

const key=value=>String(value??'').trim().toLowerCase().replace(/[_.\-]+/g,' ').replace(/\s+/g,' ');
const blank=value=>value==null||String(value).trim()==='';
const moneyValue=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string')return null;
  let text=value.trim().replace(/^(?:₹|INR\s*|Rs\.?\s*)/i,'').trim();
  let negative=false;
  if(/^\(.*\)$/.test(text)){negative=true;text=text.slice(1,-1).trim();}
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(text))return null;
  const number=Number(text.replace(/,/g,''));
  return Number.isFinite(number)?(negative?-number:number):null;
};
const headerIndex=(headers,names)=>headers.findIndex(header=>names.includes(key(header)));
const hasHeader=(headers,name)=>headers.some(header=>key(header)===name);
const sectionTerm=(rows,index)=>{
  // Check the nearest section label first: a workbook commonly puts a long-term
  // section immediately after a short-term section.
  for(let cursor=index-1;cursor>=Math.max(0,index-4);cursor--){
    const context=rows[cursor].map(value=>String(value??'')).join(' ').toLowerCase();
    if(/short\s*term/.test(context))return 'short-term';
    if(/long\s*term/.test(context))return 'long-term';
  }
  return 'unclassified';
};
const sectionType=(headers,rows,index)=>{
  const joined=headers.map(key).join(' ');
  if(joined.includes('unrealised p&l')||joined.includes('unrealized p&l'))return 'unrealised';
  const context=rows.slice(Math.max(0,index-3),index).flat().map(value=>String(value??'')).join(' ').toLowerCase();
  return /unrealised|unrealized/.test(context)?'unrealised':'realised';
};
const isHeader=row=>Array.isArray(row)&&hasHeader(row,'stock name')&&hasHeader(row,'quantity')&&row.some(cell=>/^(?:realised|realized|unrealised|unrealized) p&l(?: %)?$/i.test(String(cell??'').trim()));
const text=value=>String(value??'').trim();

function rowEntry(row,headers,kind,term,type,sheet,sourceRow){
  const get=(...names)=>{const index=headerIndex(headers,names);return index<0?undefined:row[index];};
  const symbol=text(get('stock name','symbol','scrip name','company name'));
  if(!symbol||/^(?:total|subtotal|grand total|realised trades|unrealised trades)$/i.test(symbol))return null;
  const realised=moneyValue(get('realised p&l','realized p&l'));
  const unrealised=moneyValue(get('unrealised p&l','unrealized p&l'));
  const amount=type==='realised'?realised:unrealised;
  if(amount===null)return null;
  const quantity=moneyValue(get('quantity','qty'));
  const entry={symbol,isin:text(get('isin','isin code')),kind,type,term,sheet,sourceRow,pnl:amount};
  if(quantity!==null&&quantity>=0)entry.quantity=quantity;
  const fieldMap=[['buyDate',['buy date']],['sellDate',['sell date']],['closingDate',['closing date']],['buyPrice',['buy price','avg buy price']],['sellPrice',['sell price','avg sell price']],['buyValue',['buy value']],['sellValue',['sell value']]];
  for(const [field,names] of fieldMap){
    const raw=get(...names);
    const value=/date$/i.test(field)?normalizeDate(raw):moneyValue(raw);
    if(value!==null&&value!==undefined)entry[field]=value;
  }
  // A tax report must retain whether Groww labelled the realised sale short or long term.
  if(kind==='capital-gains'&&type==='realised')entry.term=term;
  return entry;
}

function periodFrom(rows){
  const joined=rows.slice(0,80).flat().map(value=>String(value??'')).join(' ');
  const match=/from\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+to\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i.exec(joined);
  return match?{start:normalizeDate(match[1]),end:normalizeDate(match[2])}:{start:null,end:null};
}

export function summarizeReferenceEntries(entries){
  const totals={realised:0,unrealised:0,shortTerm:0,longTerm:0,unclassified:0};
  for(const entry of entries){
    if(entry.type==='unrealised')totals.unrealised+=entry.pnl;
    else {totals.realised+=entry.pnl;if(entry.term==='short-term')totals.shortTerm+=entry.pnl;else if(entry.term==='long-term')totals.longTerm+=entry.pnl;else totals.unclassified+=entry.pnl;}
  }
  return Object.fromEntries(Object.entries(totals).map(([name,value])=>[name,Math.round((value+Number.EPSILON)*100)/100]));
}

/** Parse Groww P&L or Capital Gains reports as local reference data.
 * These reports never create, remove, or allocate diary lots. */
export function parseReferenceRows(rows,kind,sheet='Sheet1'){
  const entries=[];const warnings=[];
  if(!['pnl','capital-gains'].includes(kind))return {kind,entries,warnings:['Unsupported reference report kind.'],period:{start:null,end:null},worksheets:[]};
  const source=(Array.isArray(rows)?rows:[]).slice(0,MAX_ROWS).map(row=>Array.isArray(row)?row:[]);
  if(rows.length>MAX_ROWS)warnings.push(`Only the first ${MAX_ROWS.toLocaleString('en-IN')} rows were read.`);
  for(let i=0;i<source.length;i++){
    if(!isHeader(source[i]))continue;
    const headers=source[i].map(value=>String(value??'').trim());
    const type=sectionType(headers,source,i),term=sectionTerm(source,i);
    for(let j=i+1;j<source.length;j++){
      if(isHeader(source[j]))break;
      const entry=rowEntry(source[j],headers,kind,term,type,sheet,j+1);
      if(entry)entries.push(entry);
    }
  }
  if(!entries.length)warnings.push('No supported P&L rows were found. Use the Groww P&L or Capital Gains Excel export.');
  const period=periodFrom(source);
  return {kind,entries,warnings,period,summary:summarizeReferenceEntries(entries),worksheets:[{name:sheet,entries:entries.length}]};
}

export async function parseReferenceStatement(file,kind){
  const empty={kind,entries:[],warnings:[],period:{start:null,end:null},summary:summarizeReferenceEntries([]),worksheets:[]};
  if(!file)return {...empty,warnings:['Choose a report file first.']};
  if(file.size>MAX_FILE_BYTES)return {...empty,warnings:[`This file is larger than the ${MAX_FILE_BYTES/1024/1024} MB local import limit.`]};
  const name=String(file.name||'').toLowerCase();
  try{
    if(/\.csv$/i.test(name)){
      const {default:Papa}=await import('papaparse');
      const parsed=Papa.parse(await file.text(),{skipEmptyLines:false});
      if(parsed.errors?.length)return {...empty,warnings:['Malformed CSV. Nothing was saved. Export the report again and retry.']};
      return parseReferenceRows(parsed.data,kind,'CSV');
    }
    if(/\.xlsx?$/i.test(name)){
      const XLSX=await import('xlsx');
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
      let reports=workbook.SheetNames.map(sheet=>parseReferenceRows(XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,blankrows:false,defval:''}),kind,sheet));
      // Groww's P&L workbook repeats the same position in Trade Level and Scrip
      // Level. Prefer the detailed Trade Level sheet so totals are never doubled.
      if(kind==='pnl'){
        const detailed=reports.filter(report=>/trade\s*level/i.test(report.worksheets[0]?.name||'')&&report.entries.length);
        if(detailed.length)reports=detailed;
      }
      const entries=reports.flatMap(report=>report.entries);
      const periods=reports.map(report=>report.period).filter(period=>period.start&&period.end);
      const period=periods[0]||{start:null,end:null};
      const warnings=reports.flatMap(report=>report.warnings).filter((warning,index,all)=>all.indexOf(warning)===index);
      return {kind,entries,warnings,period,summary:summarizeReferenceEntries(entries),worksheets:reports.flatMap(report=>report.worksheets)};
    }
    return {...empty,warnings:['Use a CSV or Excel export for P&L and Capital Gains reports. PDF layouts are not stored as tax data.']};
  }catch(error){return {...empty,warnings:[`This report could not be read locally: ${error.message}`]};}
}
