// src/App.jsx
import React from 'react';
import { Layout, Typography, Input, Nav, Avatar, Button } from '@douyinfe/semi-ui';
import '@semi-bot/semi-theme-mamage_day/semi.css';
import { IconUser, IconSearch } from '@douyinfe/semi-icons';
import ProjectCard from './ProjectCard';
import ProjectDetail from './ProjectDetail';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

// 假数据：项目列表
const projects = [
  {
    id: 1,
    title: '遇见青岛',
    description: '科技节期间拍摄的青岛风光233333311111111111111111111',
    subtitle: '官方影展',
    date: '2025.11.24',
    count: 24,
    images: [
      'https://images.pexels.com/photos/132037/pexels-photo-132037.jpeg',
      'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg',
      'https://images.pexels.com/photos/462162/pexels-photo-462162.jpeg',

      'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg',
      'https://images.pexels.com/photos/327482/pexels-photo-327482.jpeg',
      'https://images.pexels.com/photos/132037/pexels-photo-132037.jpeg',
      'https://images.pexels.com/photos/462162/pexels-photo-462162.jpeg',
      'https://images.pexels.com/photos/327482/pexels-photo-327482.jpeg',
    ],
  },
  {
    id: 2,
    title: '大约在冬季',
    description: '开展在学校里的冬季的浪漫故事',
    subtitle: '官方影展',
    date: '2025.11.24',
    count: 19,
    images: [
      'https://images.pexels.com/photos/1323550/pexels-photo-1323550.jpeg',
      'https://images.pexels.com/photos/556667/pexels-photo-556667.jpeg',
      'https://images.pexels.com/photos/773594/pexels-photo-773594.jpeg',
      'https://images.pexels.com/photos/2896495/pexels-photo-2896495.jpeg',
      'https://images.pexels.com/photos/132037/pexels-photo-132037.jpeg'
    ],
  },
  {
    id: 3,
    title: '爱你不止七夕',
    description: '七夕校园内的活动666666',
    subtitle: '校园活动',
    date: '2025.11.24',
    count: 16,
    images: [
      'https://images.pexels.com/photos/556667/pexels-photo-556667.jpeg',
      'https://images.pexels.com/photos/207983/pexels-photo-207983.jpeg',
      'https://images.pexels.com/photos/461230/pexels-photo-461230.jpeg',
      'https://images.pexels.com/photos/433452/pexels-photo-433452.jpeg',
    ],
  },
  {
    id: 4,
    title: '爱你不止七夕',
    description: '七夕校园内的活动666666',
    subtitle: '校园活动',
    date: '2025.11.24',
    count: 16,
    images: [
      'https://images.pexels.com/photos/556667/pexels-photo-556667.jpeg',
      'https://images.pexels.com/photos/207983/pexels-photo-207983.jpeg',
      'https://images.pexels.com/photos/461230/pexels-photo-461230.jpeg',
      'https://images.pexels.com/photos/433452/pexels-photo-433452.jpeg',
    ],
  },
];

function App() {
  const [currentProject, setCurrentProject] = React.useState(null);

  const handleSelectProject = (project) => {
    setCurrentProject(project);
  };

  const handleBackToList = () => {
    setCurrentProject(null);
  };

  return (
    <Layout style={{ background: '#f4f4f4ff' }}>
      <Header
      style={{
      position: 'sticky',   // 关键
      top: 0,               // 关键：贴在视口顶部
      zIndex: 1000,         // 确保在卡片之上
      padding: 0,
      background: '#ffffff', // 给个背景，不然下面内容会透出来
    }}
    >
         <div style={{ padding: '0 0px' }}>
          <Nav
            mode="horizontal"
            items={[
              { itemKey: 'projects', text: '项目' },
              { itemKey: 'scenery', text: '风景' },
              { itemKey: 'function', text: '功能' },
              { itemKey: 'about', text: '关于' },
            ]}
            header={{
              text: 'MaMage 图库',
            }}
            footer={
              
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Input
                placeholder="搜索项目 / 标签"
                prefix={<IconSearch />}
                showClear
                style={{ width: 260 }}
              />
              <Avatar
                size="small"
                color="orange"
                icon={<IconUser />}
              />
            </div>
            }
        />
          
        </div>
      </Header>

      <Content style={{ padding: 24 }}>
        <div className="project-page">
          {currentProject ? (
            <ProjectDetail project={currentProject} onBack={handleBackToList} />
          ) : (
            <div className="project-grid">
              {projects.map(p => (
                <ProjectCard
                  key={p.id}
                  {...p}
                  onClick={() => handleSelectProject(p)}
                />
              ))}
            </div>
          )}
        </div>
      </Content>

      <Footer style={{ textAlign: 'center' }}>
        MaMage 校园图库 © {new Date().getFullYear()}
      </Footer>
    </Layout>
  );
}

export default App;
