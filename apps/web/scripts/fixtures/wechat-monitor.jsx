import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/global.css';
import '../../src/liquidGlass.css';
import WechatMonitor from '../../src/WechatMonitor';
createRoot(document.getElementById('root')).render(<><p style={{ padding: '8px 24px', fontSize: 12, color: '#888' }}>交互测试 · 合成文章与测试数据，非目标官微采集结果</p><WechatMonitor workspaceId={900043} /></>);
