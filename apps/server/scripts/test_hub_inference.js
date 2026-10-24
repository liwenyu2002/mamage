const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { detectFaces, vision, parseFaces, FACE_VERSION, assertLegacyFaceCompatibility } = require('../lib/hub_inference');

const options = { baseUrl: 'https://fixture.invalid/hub', apiKey: 'test-private-key' };
const vector = Array(512).fill(1 / Math.sqrt(512));
const face = { bbox: [10, 20, 50, 80], det_score: 0.95, kps: Array(5).fill([25, 40]), embedding: vector };
const jpeg = () => sharp({ create: { width: 100, height: 100, channels: 3, background: '#888' } }).jpeg().toBuffer();

test('hub face transport sends unchanged JPEG bytes, validates embedding and maps pixel coordinates', async () => {
  const input = await jpeg();
  const result = await detectFaces(input, { ...options, fetch: async (url, request) => {
    assert.equal(url, 'https://fixture.invalid/hub/v1/face/embed');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer test-private-key');
    assert.deepEqual(request.body, input);
    return Response.json({ count: 1, faces: [face] });
  } });
  assert.equal(result.modelVersion, FACE_VERSION);
  assert.equal(result.meta.imageWidth, 100);
  assert.deepEqual(result.faces[0].bbox, { left: 0.1, top: 0.2, width: 0.4, height: 0.6, normalized: true, unit: 'ratio' });
  assert.ok(Math.abs(Math.hypot(...result.faces[0].normalizedEmbedding) - 1) < 1e-10);
  const noFaces = await detectFaces(input, { ...options, embed: false, fetch: async url => {
    assert.ok(url.endsWith('/detect')); return Response.json({ count: 0, faces: [] });
  } });
  assert.equal(noFaces.faces.length, 0);
});

test('face vectors are not silently assigned the old model version; malformed responses fail closed', () => {
  for (const malformed of [{ count: 1, faces: [] }, { count: 1, faces: [{ ...face, embedding: [0] }] },
    { count: 1, faces: [{ ...face, det_score: 4 }] }, { count: 1, faces: [{ ...face, bbox: [80, 10, 50, 30] }] },
    { count: 1, faces: [{ ...face, embedding: vector.map(() => 0) }] }]) {
    assert.throws(() => parseFaces(malformed, { width: 100, height: 100 }, true), /HUB_FACE_OUTPUT_INVALID/);
  }
  assert.notEqual(FACE_VERSION, '0.7.3');
});

test('album/selfie provider cannot enter the legacy embedding space without explicit compatibility approval', () => {
  const previous = process.env.FACE_HUB_LEGACY_SPACE_APPROVED;
  try {
    delete process.env.FACE_HUB_LEGACY_SPACE_APPROVED;
    assert.throws(assertLegacyFaceCompatibility, /HUB_FACE_COMPATIBILITY_NOT_APPROVED/);
    assert.equal(parseFaces({ count:1,faces:[face] },{width:100,height:100},true).modelVersion, FACE_VERSION);
    process.env.FACE_HUB_LEGACY_SPACE_APPROVED = '1';
    assert.doesNotThrow(assertLegacyFaceCompatibility);
    assert.equal(parseFaces({ count:1,faces:[face] },{width:100,height:100},true).modelVersion,null);
  } finally {
    if (previous===undefined) delete process.env.FACE_HUB_LEGACY_SPACE_APPROVED;
    else process.env.FACE_HUB_LEGACY_SPACE_APPROVED=previous;
  }
});

test('hub vision sends image bytes instead of signed media URLs, turns thinking off, ignores reasoning', async () => {
  const image = `data:image/jpeg;base64,${(await jpeg()).toString('base64')}`;
  const result = await vision({ images: [image], prompt: '只输出 JSON', schema: { type: 'object' } }, {
    ...options, fetch: async (_url, request) => {
      const sent = JSON.parse(request.body);
      assert.equal(sent.model, 'qwen'); assert.equal(sent.reasoning_effort, 'none');
      assert.equal(sent.response_format.type, 'json_object');
      assert.equal(sent.messages[0].content[0].image_url.url, image);
      return Response.json({ model: 'qwen', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', reasoning: 'ignored' } }] });
    },
  });
  assert.equal(result.content, '{"ok":true}');
  for (const message of [{ content: '', reasoning: '{"ok":true}' }, { content: '{broken' }]) {
    await assert.rejects(vision({ images: [image], prompt: 'JSON', schema: {} }, {
      ...options, fetch: async () => Response.json({ choices: [{ finish_reason: 'stop', message }] }),
    }), /HUB_VISION_OUTPUT_INVALID/);
  }
  await assert.rejects(vision({ images: [image], prompt: 'test' }, {
    ...options, fetch: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
  }), /HUB_VISION_OUTPUT_INVALID/);
});

test('hub errors never retain secrets or upstream bodies; plaintext endpoints are forbidden', async () => {
  const image = `data:image/jpeg;base64,${(await jpeg()).toString('base64')}`;
  for (const fetch of [async () => new Response('private upstream body', { status: 401 }),
    async () => { throw new Error('request Authorization: Bearer test-private-key'); }]) {
    await assert.rejects(vision({ images: [image], prompt: 'test' }, { ...options, fetch }), error => {
      assert.ok(!JSON.stringify(error).includes('test-private-key'));
      assert.ok(!String(error.stack).includes('test-private-key'));
      assert.ok(!String(error.stack).includes('private upstream body'));
      return true;
    });
  }
  await assert.rejects(vision({ images: [image], prompt: 'test' }, { ...options, baseUrl: 'http://fixture.invalid' }), /HUB_CONFIG_INVALID/);
  await assert.rejects(vision({ images: ['https://private.invalid/image?token=secret'], prompt: 'test' }, options), /HUB_VISION_INPUT_INVALID/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(vision({ images: [image], prompt: 'test' }, { ...options, signal: controller.signal,
    fetch: async () => { throw new Error('transport'); } }), /cancelled/);
});

test('echoing JSON Schema cannot pass as image evidence', async () => {
  const image = `data:image/jpeg;base64,${(await jpeg()).toString('base64')}`;
  const schema = { type: 'object', additionalProperties: false, required: ['people'],
    properties: { people: { type: 'array', items: { type: 'object', required: ['index'], properties: { index: { type: 'integer' } } } } } };
  for (const data of [schema, { people: [{ index: '1' }] }, { people: [], invented: true }]) {
    await assert.rejects(vision({ images: [image], prompt: 'JSON', schema }, {
      ...options, fetch: async (_url,request) => {
        assert.ok(JSON.parse(request.body).messages[0].content.at(-1).text.includes('不要返回 Schema 本身'));
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
      },
    }), /HUB_VISION_OUTPUT_INVALID/);
  }
});

test('schema alternatives allow only explicitly valid structures, not partial or mistyped profiles', async () => {
  const image = `data:image/jpeg;base64,${(await jpeg()).toString('base64')}`;
  const schema = { type:'object',additionalProperties:false,required:['profile'],properties:{profile:{anyOf:[
    {type:'object',additionalProperties:false,required:['description'],properties:{description:{type:'string'}}},
    {type:'object',additionalProperties:false,properties:{}},
  ]}}};
  const infer = profile => vision({images:[image],prompt:'JSON',schema},{...options,
    fetch:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({profile})}}]})});
  for (const profile of [{},{description:'可见上衣'}]) await infer(profile);
  for (const profile of [null,[],{description:1},{invented:true},{description:'可见',invented:true}]) {
    await assert.rejects(infer(profile),/HUB_VISION_OUTPUT_INVALID/);
  }
});

test('photo semantics and scored culling use hub without losing technical quality or leaking media URLs', async () => {
  const http = require('node:http');
  const hub = require('../lib/hub_inference');
  const tags = require('../ai_function/ai_for_tags/ai_for_tags');
  const image = await sharp(await jpeg()).webp().toBuffer();
  const server = http.createServer((_req,res) => { res.writeHead(200,{'Content-Type':'image/webp'});res.end(image); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const previousProvider = process.env.AI_VISION_PROVIDER;
  const previousVision = hub.vision;
  process.env.AI_VISION_PROVIDER = 'zgcai';
  try {
    const source = `http://127.0.0.1:${server.address().port}/image?signature=private`;
    hub.vision = async input => {
      assert.ok(input.images[0].startsWith('data:image/jpeg;base64,'));
      assert.ok(!JSON.stringify(input).includes('signature=private'));
      return { content:'description=一位学生在教室内进行展示。\ntags=[AI medium,单人,教室]', model:'qwen' };
    };
    const semantic = await tags.analyze(source);
    assert.equal(semantic.provider,'zgcai');assert.ok(semantic.tags.includes('单人'));
    hub.vision = async input => {
      assert.ok(input.prompt.includes('程序已在原图实测'));
      assert.ok(input.prompt.includes('不按发言者或主要人物的人数计数'));
      assert.ok(!input.prompt.includes('只有一位演讲者或发言者时必须写单人'));
      return { content:JSON.stringify({ description:'一位学生在教室内进行展示。',standardTags:['单人','教室'],customTags:[],ocrText:'',
        quality:{ composition:5,subject:5,moment:5,aesthetics:5,flags:[],reason:'主体清楚，构图较为普通。' } }),model:'qwen' };
    };
    const scored = await tags.analyzePhoto(source);
    assert.equal(scored.provider,'zgcai');assert.ok(Number.isFinite(scored.score));assert.ok(scored.quality.tech);
    assert.ok(scored.tags.some(tag=>tag.startsWith('AI ')));
  } finally {
    hub.vision = previousVision;
    if (previousProvider===undefined) delete process.env.AI_VISION_PROVIDER;else process.env.AI_VISION_PROVIDER=previousProvider;
    await new Promise(resolve=>server.close(resolve));
  }
});

test('a caption mentioning one main subject cannot overwrite an explicit multi-person visual label', () => {
  const { parseVisionResponse } = require('../ai_function/ai_for_tags/ai_for_tags');
  const result = parseVisionResponse(JSON.stringify({ description:'一名红衣男子手持麦克风，身旁黑衣与白衣青年分别站立。',standardTags:['多人','演讲'] }));
  assert.ok(result.tags.includes('多人'));assert.ok(!result.tags.includes('单人'));
  const conflict = parseVisionResponse(JSON.stringify({ description:'一位学生在台上。',standardTags:['单人','多人','室内'] }));
  assert.ok(!conflict.tags.includes('单人'));assert.ok(!conflict.tags.includes('多人'));assert.ok(conflict.tags.includes('室内'));
});

test('video storyboard and global evidence use the same hub transport without changing time parsing', async () => {
  const hub = require('../lib/hub_inference');
  const semantic = require('../ai_function/ai_for_video/video_semantic');
  const previous = process.env.VIDEO_SEMANTIC_VISION_PROVIDER;
  const previousVision = hub.vision;
  process.env.VIDEO_SEMANTIC_VISION_PROVIDER = 'zgcai';
  try {
    let calls = 0;
    hub.vision = async input => {
      calls++;assert.ok(input.images[0].startsWith('data:image/jpeg;base64,'));
      return { content: JSON.stringify({ summary:'人物在舞台上发言',actions:['发言'],keyObjects:['麦克风'],
        timelineFacts:['00:00-00:05｜人物发言'],event:'校园活动',setting:'舞台',evidence:['人物手持麦克风'],confidence:0.8 }),model:'Qwen3.6-35B-A3B' };
    };
    const image = await jpeg();
    const temporal = await semantic.analyzeTemporalStoryboard(image,{start:0,end:5,frameTimes:[0,2.5,5]});
    const global = await semantic.analyzeGlobalEvidenceBoard(image,{duration:5});
    assert.equal(temporal.provider,'zgcai');assert.equal(global.provider,'zgcai');assert.equal(calls,2);
    assert.ok(semantic.isVisionEnabled());
  } finally {
    hub.vision = previousVision;
    if(previous===undefined)delete process.env.VIDEO_SEMANTIC_VISION_PROVIDER;else process.env.VIDEO_SEMANTIC_VISION_PROVIDER=previous;
  }
});
