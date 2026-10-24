const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { analyzePeople, prepareImages } = require('../lib/person_visual_inference');
const { assertionKey } = require('../lib/person_visual_evidence');
const face = { id: 12, x: 0.4, y: 0.1, w: 0.1, h: 0.1, unit: 'ratio' };
const image = () => sharp({create:{width:500,height:500,channels:3,background:'#888'}}).jpeg().toBuffer();
const result = { index: 1, binding: 'clear', visibility: 'clear', colors: ['green'], activities: {}, observation: '目标穿绿色上衣' };

test('real image preparation and transport bind local face anchors, enforce schema and disable thinking', async () => {
  const buffer = await image();
  let sent;
  const values = await analyzePeople(buffer,[face],{baseUrl:'http://fixture.invalid',fetch:async(_url,options)=>{
    sent = JSON.parse(options.body);
    return Response.json({done:true,done_reason:'stop',response:JSON.stringify({people:[result]})});
  }});
  assert.equal(sent.images.length,1);
  assert.equal(sent.think,false);
  assert.ok(sent.format.properties.people);
  assert.ok(!JSON.stringify(sent).includes('personId'));
  assert.deepEqual(values.get(12).colors,['green']);
  assert.equal((await prepareImages(buffer,[{...face,w:0.001}])).valid.length,0);
});

test('model failures, duplicate anchors and arbitrary thinking cannot become positive evidence', async () => {
  const buffer = await image();
  const call = body => analyzePeople(buffer,[face],{baseUrl:'http://fixture.invalid',fetch:async()=>Response.json(body)});
  const fallback = await call({done:true,done_reason:'stop',response:'',thinking:JSON.stringify({people:[result]})});
  assert.deepEqual(fallback.get(12).colors,['green']);
  for (const body of [{done:true,thinking:'I think this is green'},
    {done:true,done_reason:'length',response:JSON.stringify({people:[result]})},
    {done:true,response:'{"people":'}]) await assert.rejects(call(body), error => error.causeCode === 'VISUAL_MODEL_OUTPUT_INVALID');
  const duplicate = await call({done:true,response:JSON.stringify({people:[result,result]})});
  assert.equal(duplicate.get(12).binding,'uncertain');
  const invented = await call({done:true,response:JSON.stringify({people:[{...result,index:999}]})});
  assert.equal(invented.get(12).binding,'uncertain');
});

test('free-form conditions are bounded data and only requested assertion IDs are accepted', async () => {
  const key = assertionKey('手里拿着相机');
  const values = await analyzePeople(await image(),[face],{baseUrl:'http://fixture.invalid',assertions:[{key,value:'手里拿着相机'}],
    fetch:async(_url,options)=>{
      const sent=JSON.parse(options.body);
      assert.ok(sent.format.properties.people.items.properties.assertions.properties[key]);
      return Response.json({done:true,response:JSON.stringify({people:[{...result,assertions:{[key]:{state:'yes',observation:'手持相机'},invented:{state:'yes'}}}]})});
    }});
  assert.deepEqual(Object.keys(values.get(12).assertions),[key]);
  assert.equal(values.get(12).assertions[key].state,'yes');
});

test('hub person verification preserves anchor validation and uses its own evidence namespace', async () => {
  const previous = Object.fromEntries(['SEARCH_VISUAL_PROVIDER','ZGCAI_API_KEY'].map(key=>[key,process.env[key]]));
  process.env.SEARCH_VISUAL_PROVIDER = 'zgcai'; process.env.ZGCAI_API_KEY = 'test-private-key';
  try {
    const { evidenceKey } = require('../lib/person_visual_evidence');
    const hubKey = evidenceKey(face);
    const values = await analyzePeople(await image(), [face], { fetch: async (url, options) => {
      assert.ok(url.endsWith('/v1/chat/completions'));
      const sent = JSON.parse(options.body);
      assert.equal(sent.messages[0].content.filter(item=>item.type==='image_url').length,1);
      const { activities, ...clothing } = result;
      return Response.json({ choices: [{ finish_reason:'stop',message:{ content:JSON.stringify({people:[clothing]}) } }] });
    } });
    assert.deepEqual(values.get(12).colors,['green']);
    delete process.env.SEARCH_VISUAL_PROVIDER;
    assert.notEqual(evidenceKey(face),hubKey);
  } finally {
    for (const [key,value] of Object.entries(previous)) { if (value===undefined) delete process.env[key]; else process.env[key]=value; }
  }
});

test('an uncertain empty profile does not reject other people in a production Hub batch', async () => {
  const previous = Object.fromEntries(['SEARCH_VISUAL_PROVIDER','ZGCAI_API_KEY'].map(key=>[key,process.env[key]]));
  process.env.SEARCH_VISUAL_PROVIDER = 'zgcai'; process.env.ZGCAI_API_KEY = 'test-private-key';
  const activities = { speech:'unknown', group_photo:'unknown', award:'unknown', signing:'unknown' };
  const profile = { clothing:{ upper:'绿色上衣',lower:'' },actions:['站立'],heldObjects:[],position:'画面左侧' };
  const rows = [
    { ...result, activities, profile },
    { ...result, index:2, binding:'uncertain', activities, profile:{} },
  ];
  try {
    let calls = 0;
    const values = await analyzePeople(await image(), [face,{...face,id:13,x:0.6}], { profile:true,
      fetch:async()=>{ calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({people:rows})}}]}); } });
    assert.equal(calls,2,'uncertainty must not bypass the second visual review');
    assert.equal(values.get(12).binding,'clear');
    assert.equal(values.get(12).profile.clothing.upper,'绿色上衣');
    assert.equal(values.get(13).binding,'uncertain');
    assert.deepEqual(values.get(13).profile,{clothing:{upper:'',lower:''},actions:[],heldObjects:[],position:'',description:''});

    rows[1].binding = 'clear';
    const incomplete = await analyzePeople(await image(),[face,{...face,id:13,x:0.6}],{profile:true,
      fetch:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({people:rows})}}]})});
    assert.equal(incomplete.get(13).binding,'uncertain','empty data must never become positive evidence');
    assert.equal(incomplete.get(13).profile.description,'');

    rows[1].profile = {clothing:{upper:17}};
    await assert.rejects(analyzePeople(await image(),[face,{...face,id:13,x:0.6}],{profile:true,
      fetch:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({people:rows})}}]})}), error => error.causeCode === 'HUB_VISION_OUTPUT_INVALID');
  } finally {
    for (const [key,value] of Object.entries(previous)) { if(value===undefined)delete process.env[key];else process.env[key]=value; }
  }
});
