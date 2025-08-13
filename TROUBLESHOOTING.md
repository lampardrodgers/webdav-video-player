# WebDAV视频播放器故障排除指南

## 常见错误及解决方案

### 1. "Cannot read properties of undefined (reading 'createClient')"

**错误原因：** WebDAV客户端库未正确加载

**解决方案：**
1. **检查网络连接**：确保能访问外部CDN
2. **刷新页面**：应用会自动尝试多个CDN源
3. **使用本地库文件**：运行以下命令下载库文件到本地
   ```bash
   node download-webdav.js
   ```
   然后修改HTML文件，使用本地文件：
   ```html
   <script src="webdav.min.js"></script>
   ```

4. **检查浏览器控制台**：
   - 打开开发者工具 (F12)
   - 查看Console标签页
   - 寻找"WebDAV库从XXX加载成功"的消息

### 2. WebDAV连接失败

**可能原因：**
- 服务器地址错误
- 认证信息错误
- 网络连接问题
- CORS（跨域）限制
- 服务器不支持WebDAV

**解决步骤：**

#### 2.1 验证服务器地址
确保WebDAV URL格式正确：
```
✅ 正确格式：
- https://your-server.com/webdav/
- https://nextcloud.example.com/remote.php/dav/files/username/
- https://your-nas.local:5006/

❌ 错误格式：
- your-server.com (缺少协议)
- https://your-server.com (缺少WebDAV路径)
```

#### 2.2 测试WebDAV连接
使用命令行工具测试：
```bash
# 使用curl测试连接
curl -X PROPFIND \
  -H "Depth: 1" \
  -u "username:password" \
  "https://your-server.com/webdav/"

# 应该返回XML响应，而不是错误
```

#### 2.3 检查认证方式
不同服务器可能需要不同的认证：
- **Nextcloud/ownCloud**：需要应用专用密码
- **群晖NAS**：使用DSM账户密码
- **自建服务**：检查.htpasswd配置

### 3. CORS（跨域）问题

**错误信息：** "Access to fetch at 'xxx' from origin 'file://' has been blocked by CORS policy"

**解决方案：**

#### 3.1 配置服务器CORS（推荐）
在WebDAV服务器上添加CORS头：
```apache
# Apache配置
Header always set Access-Control-Allow-Origin "*"
Header always set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, PROPFIND"
Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth"
```

```nginx
# Nginx配置
add_header Access-Control-Allow-Origin "*";
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, PROPFIND";
add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth";
```

#### 3.2 使用本地HTTP服务器
不要直接打开HTML文件，而是通过HTTP服务器访问：
```bash
# 使用Python启动简单服务器
cd webdav-video-demo
python -m http.server 8000

# 然后访问 http://localhost:8000
```

#### 3.3 使用浏览器扩展
安装CORS扩展（仅用于开发测试）：
- Chrome: "CORS Unblock"
- Firefox: "CORS Everywhere"

### 4. 视频播放问题

#### 4.1 视频格式不支持
**检查支持的格式：**
应用启动时会在日志中显示支持的格式，例如：
```
检测到支持的视频格式 { "supported": [ "mp4", "webm", "ogg", "m4v" ] }
```

**解决方案：**
- 转换视频格式为MP4 (H.264/AAC)
- 使用现代浏览器
- 检查视频编码是否兼容

#### 4.2 视频加载缓慢
**优化建议：**
- 使用较小的视频文件进行测试
- 检查网络带宽
- 确保WebDAV服务器性能良好
- 考虑视频压缩

### 5. 特定服务器配置

#### 5.1 Nextcloud配置
```
服务器地址: https://your-nextcloud.com/remote.php/dav/files/USERNAME/
用户名: 你的Nextcloud用户名
密码: 应用专用密码（在设置→安全中生成）
基础路径: /
```

**生成应用专用密码：**
1. 登录Nextcloud
2. 设置 → 安全
3. 设备和会话 → 创建新的应用专用密码
4. 输入名称（如"WebDAV Player"）
5. 使用生成的密码

#### 5.2 群晖NAS配置
```
服务器地址: https://your-nas.local:5006/
用户名: DSM用户名
密码: DSM密码
基础路径: /
```

**启用WebDAV：**
1. 控制面板 → 文件服务
2. 启用WebDAV (HTTP: 5005, HTTPS: 5006)
3. 确保防火墙允许这些端口

#### 5.3 Apache WebDAV配置
```apache
LoadModule dav_module modules/mod_dav.so
LoadModule dav_fs_module modules/mod_dav_fs.so

<Directory "/var/www/webdav">
    DAV On
    AuthType Basic
    AuthName "WebDAV"
    AuthUserFile /etc/apache2/.htpasswd
    Require valid-user
    
    # CORS支持
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, PROPFIND"
    Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth"
</Directory>
```

### 6. 调试工具

#### 6.1 浏览器开发者工具
打开控制台 (F12)，使用调试命令：
```javascript
// 检查应用状态
debugApp.getStatus()

// 查看详细日志
debugApp.getLogs()

// 测试WebDAV连接
debugApp.testConnection()

// 获取日志统计
debugApp.getLogStats()
```

#### 6.2 网络调试
在Network标签页中检查：
- WebDAV请求是否发送成功
- 响应状态码
- 响应头信息
- 错误消息

#### 6.3 日志分析
应用提供详细的日志记录：
- 连接过程
- 文件操作
- 错误信息
- 性能数据

### 7. 性能优化

#### 7.1 网络优化
- 使用有线连接而非WiFi
- 确保网络延迟低
- 避免并发下载

#### 7.2 服务器优化
- 增加WebDAV服务器内存
- 优化磁盘I/O性能
- 使用SSD存储

#### 7.3 客户端优化
- 使用现代浏览器
- 关闭不必要的浏览器扩展
- 增加浏览器缓存大小

### 8. 安全注意事项

- **使用HTTPS**：避免密码明文传输
- **应用专用密码**：不要使用主账户密码
- **本地运行**：避免将应用部署到公共服务器
- **防火墙配置**：只开放必要的端口

### 9. 获取帮助

如果问题仍未解决：

1. **查看日志**：导出详细日志进行分析
2. **检查版本**：确保使用最新版本的应用和服务器
3. **社区支持**：寻求WebDAV服务器社区帮助
4. **备用方案**：考虑使用其他文件访问方式

### 10. 常用测试命令

```bash
# 测试基本连接
curl -I https://your-server.com/webdav/

# 测试WebDAV PROPFIND
curl -X PROPFIND \
  -H "Depth: 1" \
  -H "Content-Type: text/xml" \
  -u "username:password" \
  "https://your-server.com/webdav/" \
  -d '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'

# 测试文件下载
curl -u "username:password" \
  "https://your-server.com/webdav/test-video.mp4" \
  --output test.mp4
```