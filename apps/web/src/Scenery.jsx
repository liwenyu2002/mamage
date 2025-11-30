import React from 'react';
import { Typography, Card, Row, Col } from '@douyinfe/semi-ui';
import './Scenery.css';

const { Title, Text } = Typography;

export default function Scenery() {
  const sample = Array.from({ length: 6 }).map((_, i) => ({
    id: i + 1,
    title: `风景 ${i + 1}`,
    thumb: `/uploads/assets/landscape${(i % 4) + 1}.jpg`
  }));

  return (
    <div className="scenery-page">
      <div style={{ marginBottom: 16 }}>
        <Title heading={3} style={{ margin: 0 }}>风景</Title>
        <Text type="tertiary">精选风光集锦 — 点击可查看详情</Text>
      </div>

      <Row gutter={16}>
        {sample.map((p) => (
          <Col key={p.id} span={8}>
            <Card
              bordered
              bodyStyle={{ padding: 0 }}
              style={{ cursor: 'pointer' }}
              onClick={() => { /* 未来可实现跳转到项目详情 */ }}
            >
              <div style={{ width: '100%', height: 160, background: '#f6f6f6' }}>
                <img src={p.thumb} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>作者 / 来源</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

    </div>
  );
}
