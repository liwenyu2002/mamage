// src/App.jsx
import React from 'react';
import { Layout, Nav, Button, Typography } from '@douyinfe/semi-ui';

// ★ 使用你生成的 MaMage 主题样式
import '@semi-bot/semi-theme-mamage/semi.css';
// 如果这行报错，再换成：
// import '@semi-bot/semi-theme-mamage/semi.min.css';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

function App() {
  return (
    <Layout>
      <Header>
        <Nav
          mode="horizontal"
          header={{ text: 'MaMage 图库' }}
        />
      </Header>
      <Content style={{ padding: '24px' }}>
        <Title heading={2}>你好，这是 Semi + MaMage 主题</Title>
        <Text>
          这里按钮和导航的颜色，就是你在 Semi 主题编辑器里配好的那套。
        </Text>
        <br />
        <Button theme="solid" type="primary" style={{ marginTop: 16 }}>
          上传照片
        </Button>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        MaMage © {new Date().getFullYear()}
      </Footer>
    </Layout>
  );
}

export default App;
