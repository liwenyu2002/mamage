import React from 'react';
import {
  Layout,
  Card,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Tag,
  Tabs,
  List,
  Toast,
} from '@douyinfe/semi-ui';

const { Header, Content } = Layout;
const { TextArea } = Input;

// Types
type Photo = {
  id: number;
  url: string;
  description?: string;
  tags?: string[];
};

type FormValues = {
  eventName: string;
  eventDate?: Date | null;
  location?: string;
  organizer?: string;
  participants?: string;
  highlights: string;
  usage?: string;
  tone?: string;
  targetWords?: string;
};

// Mock photos
const mockPhotos: Photo[] = [
  { id: 1, url: 'https://via.placeholder.com/320x180?text=图1', description: '大会开幕式', tags: ['开幕','大合照'] },
  { id: 2, url: 'https://via.placeholder.com/320x180?text=图2', description: '领导致辞', tags: ['致辞'] },
  { id: 3, url: 'https://via.placeholder.com/320x180?text=图3', description: '展台现场', tags: ['展台','互动'] },
];

const AiNewsWriter: React.FC = () => {
  // state
  const [selectedPhotos, setSelectedPhotos] = React.useState<Photo[]>(mockPhotos);
  const [formValues, setFormValues] = React.useState<FormValues>({
    eventName: '',
    eventDate: null,
    location: '',
    organizer: '',
    participants: '',
    highlights: '',
    usage: '官网新闻',
    tone: '正式',
    targetWords: '500-800',
  });
  const [referenceUrls, setReferenceUrls] = React.useState<string[]>([]);
  const [refInput, setRefInput] = React.useState('');
  const [stylePreset, setStylePreset] = React.useState<string>('默认风格');
  const [interviewText, setInterviewText] = React.useState('');

  const [title, setTitle] = React.useState('');
  const [subtitle, setSubtitle] = React.useState('');
  const [markdownText, setMarkdownText] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);

  // selected photos handlers
  const removePhoto = (id: number) => {
    setSelectedPhotos((s) => s.filter((p) => p.id !== id));
  };

  // reference urls handlers
  const addReference = () => {
    const v = (refInput || '').trim();
    if (!v) return;
    setReferenceUrls((s) => [...s, v]);
    setRefInput('');
  };
  const removeReference = (index: number) => {
    setReferenceUrls((s) => s.filter((_, i) => i !== index));
  };

  // generate mock
  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      // TODO: 调用后端 /api/ai/news/generate
      const mock = `# ${formValues.eventName || '活动标题示例'}\n\n${formValues.highlights || '活动亮点示例内容。'}\n\n（此处为模拟生成的正文，包含若干段落。）\n\n- 要点一\n- 要点二\n\n感谢关注。`;
      setTitle(`${formValues.eventName || '活动标题'} 的新闻稿`);
      setSubtitle(`关于 ${formValues.eventName || '本次活动'} 的报道导语`);
      setMarkdownText(mock);
      setIsGenerating(false);
      Toast.success('已生成初稿（模拟）');
    }, 1200 + Math.random() * 800);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownText);
      Toast.success('已复制为 Markdown');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  const copyHtml = async () => {
    try {
      // simple conversion: paragraphs
      const html = markdownText.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
      await navigator.clipboard.writeText(html);
      Toast.success('已复制为 HTML');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  return (
    <Layout style={{ padding: 16 }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>AI 写稿助手</h2>
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Selected photos panel */}
          <Card title={`已选照片（来自中转站）`} bordered>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {selectedPhotos.map((p) => (
                <div key={p.id} style={{ width: 160, borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#fafafa' }}>
                  <img src={p.url} alt={p.description} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.description}</div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(p.tags || []).map((t) => <Tag key={t} size="small" type="light">{t}</Tag>)}
                    </div>
                  </div>
                  <button
                    onClick={() => removePhoto(p.id)}
                    aria-label="移除照片"
                    style={{ position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left: form + reference */}
            <div style={{ flex: '1 1 420px', minWidth: 320 }}>
              <Card title="活动信息 & 参考素材" bordered>
                <Form style={{ width: '100%' }}>
                  <Form.Input label="活动名称" field="eventName" required trigger="onChange" value={formValues.eventName} onChange={(v) => setFormValues((s) => ({ ...s, eventName: v }))} placeholder="请输入活动名称" />

                  <div style={{ display: 'flex', gap: 12 }}>
                    <DatePicker value={formValues.eventDate as any} onChange={(v) => setFormValues((s) => ({ ...s, eventDate: v as Date }))} style={{ flex: 1 }} placeholder="活动日期（必填）" />
                    <Input value={formValues.location} onChange={(v) => setFormValues((s) => ({ ...s, location: v }))} placeholder="活动地点（可选）" style={{ flex: 1 }} />
                  </div>

                  <Input value={formValues.organizer} onChange={(v) => setFormValues((s) => ({ ...s, organizer: v }))} placeholder="主办/承办单位（可选）" style={{ marginTop: 12 }} />

                  <TextArea value={formValues.participants} onChange={(v) => setFormValues((s) => ({ ...s, participants: v }))} rows={3} placeholder="出席嘉宾 / 参与对象（可选）" style={{ marginTop: 12 }} />

                  <TextArea value={formValues.highlights} onChange={(v) => setFormValues((s) => ({ ...s, highlights: v }))} rows={4} placeholder="活动亮点 / 希望重点表达的内容（必填）" style={{ marginTop: 12 }} />

                  <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                    <Select
                      value={formValues.usage}
                      onChange={(v) => setFormValues((s) => ({ ...s, usage: v }))}
                      style={{ flex: 1 }}
                      placeholder="稿件用途"
                      options={[ '官网新闻', '微信推文', '年终总结', '其他' ].map((v) => ({ label: v, value: v }))}
                    />
                    <Select
                      value={formValues.tone}
                      onChange={(v) => setFormValues((s) => ({ ...s, tone: v }))}
                      style={{ flex: 1 }}
                      placeholder="文风偏好"
                      options={[ '正式', '稍微活泼', '简洁说明' ].map((v) => ({ label: v, value: v }))}
                    />
                  </div>

                  <Select
                    value={formValues.targetWords}
                    onChange={(v) => setFormValues((s) => ({ ...s, targetWords: v }))}
                    placeholder="目标字数"
                    style={{ width: 200, marginTop: 12 }}
                    options={[ '500-800', '800-1200', '1200+' ].map((v) => ({ label: v, value: v }))}
                  />
                </Form>

                <div style={{ marginTop: 16 }}>
                  <h4 style={{ margin: '0 0 8px 0' }}>参考素材 - 文章链接</h4>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Input value={refInput} onChange={(v) => setRefInput(v)} placeholder="输入参考链接并添加" />
                    <Button onClick={addReference}>添加参考链接</Button>
                  </div>
                  <List dataSource={referenceUrls} renderItem={(item, idx) => (
                    <List.Item>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <a href={item} target="_blank" rel="noreferrer">{item}</a>
                        <Button type="tertiary" onClick={() => removeReference(idx)}>删除</Button>
                      </div>
                    </List.Item>
                  )} />

                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>组织已有风格预设</h4>
                    <Select value={stylePreset} onChange={(v) => setStylePreset(String(v))} options={[ '默认风格', '学院官网通稿风', '学生会公众号风格' ].map(v => ({ label: v, value: v }))} style={{ width: 240 }} />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>采访内容/原话（可选）</h4>
                    <TextArea value={interviewText} onChange={(v) => setInterviewText(v)} rows={4} placeholder="可以粘贴采访录音转写稿的文本，AI 会适当引用其中的内容" />
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-start' }}>
                    <Button type="primary" onClick={handleGenerate} loading={isGenerating}>生成初稿</Button>
                  </div>
                </div>
              </Card>
            </div>

            {/* Right: editor */}
            <div style={{ flex: '1 1 600px', minWidth: 360 }}>
              <Card title="AI 生成结果编辑区" bordered>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <Input value={title} onChange={(v) => setTitle(v)} placeholder="稿件标题" />
                  <Input value={subtitle} onChange={(v) => setSubtitle(v)} placeholder="副标题 / 导语（可选）" />
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#666', fontSize: 13 }}>后端会根据选中照片自动在稿件中插入占位符，例如：![图1：大会开幕式全景](PHOTO:123)</div>
                </div>

                <Tabs defaultActiveKey="editor">
                  <Tabs.TabPane itemKey="editor" tab="Markdown 编辑">
                    <TextArea value={markdownText} onChange={(v) => setMarkdownText(v)} rows={14} placeholder="生成内容将在这里显示" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                      <div>当前字数：{markdownText ? markdownText.length : 0}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={copyMarkdown}>复制为 Markdown</Button>
                        <Button onClick={copyHtml}>复制为 HTML</Button>
                      </div>
                    </div>
                  </Tabs.TabPane>
                  <Tabs.TabPane itemKey="preview" tab="预览">
                    <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 4, minHeight: 240 }}>
                      {markdownText ? markdownText.split('\n\n').map((p, i) => <p key={i} style={{ margin: '8px 0' }}>{p.split('\n').map((line, j) => <React.Fragment key={j}>{line}<br/></React.Fragment>)}</p>) : <div style={{ color: '#999' }}>暂无内容</div>}
                    </div>
                  </Tabs.TabPane>
                </Tabs>

                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <Button disabled>只重写导语</Button>
                  <Button disabled>压缩到 800 字</Button>
                  <Button disabled>生成另一个版本</Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default AiNewsWriter;
