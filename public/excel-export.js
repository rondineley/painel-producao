'use strict';
// Small, dependency-free OOXML writer. ZIP entries are stored without compression.
const ProductionExcel=(()=>{
  const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
  function column(index){let result='';for(index++;index>0;index=Math.floor((index-1)/26))result=String.fromCharCode(65+(index-1)%26)+result;return result;}
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
  function zip(files){
    const encoder=new TextEncoder(),parts=[],central=[];let offset=0,centralSize=0;
    for(const [name,content] of Object.entries(files)){
      const path=encoder.encode(name),data=encoder.encode(content),checksum=crc(data);
      const local=new Uint8Array(30+path.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,checksum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,path.length,true);local.set(path,30);
      const directory=new Uint8Array(46+path.length),d=new DataView(directory.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,checksum,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,path.length,true);d.setUint32(42,offset,true);directory.set(path,46);
      parts.push(local,data);central.push(directory);offset+=local.length+data.length;centralSize+=directory.length;
    }
    const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
    const output=new Uint8Array(offset+centralSize+end.length);let at=0;for(const part of [...parts,...central,end]){output.set(part,at);at+=part.length;}return output;
  }
  function workbook({title,rows,merges=[]}){
    if(!rows.length||!rows[0].length)throw new Error('Tabela vazia.');
    const count=rows[0].length,last=column(count-1),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const cell=(value,c,r,style)=>{
      const ref=column(c)+r;
      if(value===null||value===undefined||value==='')return `<c r="${ref}" s="${style}"/>`;
      if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    };
    const titleRow=`<row r="1" ht="32" customHeight="1">${Array.from({length:count},(_,c)=>cell(c===0?title:'',c,1,1)).join('')}</row>`;
    const sheetRows=rows.map((row,i)=>`<row r="${i+2}" ht="${i===0?32:25}" customHeight="1">${row.map((value,c)=>cell(value,c,i+2,i===0||i===rows.length-1?1:c===0||c===count-1?2:i%2===0?4:3)).join('')}</row>`).join('');
    const mergeRefs=[`A1:${last}1`,...merges.map(m=>`${column(m.c1)}${m.r1+2}:${column(m.c2)}${m.r2+2}`)];
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:${last}${rows.length+1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="25"/><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="${count-1}" width="13" customWidth="1"/><col min="${count}" max="${count}" width="18" customWidth="1"/></cols><sheetData>${titleRow}${sheetRows}</sheetData><mergeCells count="${mergeRefs.length}">${mergeRefs.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const font=(color,bold=false)=>`<font><sz val="11"/><color rgb="FF${color}"/><name val="Calibri"/>${bold?'<b/>':''}</font>`;
    const fill=color=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`;
    const xf=(f,fillId,num=0)=>`<xf numFmtId="${num}" fontId="${f}" fillId="${fillId}" borderId="1" xfId="0" applyAlignment="1" applyFill="1" applyFont="1" applyNumberFormat="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`;
    const styles=`<?xml version="1.0"?><styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts><fonts count="3">${font('EDF1EF')}${font('D5F4BE',true)}${font('B9E991',true)}</fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('26352B')}${fill('202B24')}${fill('1A211E')}${fill('171E1B')}</fills><borders count="2"><border/><border><left style="thin"><color rgb="FF344338"/></left><right style="thin"><color rgb="FF344338"/></right><top style="thin"><color rgb="FF344338"/></top><bottom style="thin"><color rgb="FF344338"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">${xf(0,0)}${xf(1,2,164)}${xf(2,3,164)}${xf(0,4,164)}${xf(0,5,164)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return zip({
      '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Produção diária" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':sheet
    });
  }
  return {workbook};
})();
