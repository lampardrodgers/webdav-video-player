/**
 * WebDAV代理服务器
 * 解决浏览器CORS限制问题
 * 使用方法: node proxy-server.js
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PROXY_PORT = 8090;
const TARGET_HOST = 'webdav-1839857505.pd1.123pan.cn';
const TARGET_PATH = '/webdav';

// CORS头配置
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Date, Last-Modified, ETag',
    'Access-Control-Allow-Credentials': 'true'
};

function createProxyServer() {
    const server = http.createServer((req, res) => {
        // 解析请求URL
        const parsedUrl = url.parse(req.url, true);
        
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
        
        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200, CORS_HEADERS);
            res.end();
            return;
        }

        // 构建目标URL
        const targetUrl = `https://${TARGET_HOST}${TARGET_PATH}${parsedUrl.pathname}${parsedUrl.search || ''}`;
        
        console.log(`代理到: ${targetUrl}`);

        // 准备请求选项
        const options = {
            method: req.method,
            headers: {
                ...req.headers,
                host: TARGET_HOST
            }
        };

        // 删除可能引起问题的头
        delete options.headers['origin'];
        delete options.headers['referer'];

        // 创建到目标服务器的请求
        const proxyReq = https.request(targetUrl, options, (proxyRes) => {
            console.log(`响应状态: ${proxyRes.statusCode}`);
            
            // 设置CORS头
            const responseHeaders = {
                ...CORS_HEADERS,
                ...proxyRes.headers
            };

            res.writeHead(proxyRes.statusCode, responseHeaders);
            proxyRes.pipe(res);
        });

        // 错误处理
        proxyReq.on('error', (error) => {
            console.error('代理请求错误:', error.message);
            res.writeHead(500, CORS_HEADERS);
            res.end(JSON.stringify({
                error: '代理服务器错误',
                message: error.message
            }));
        });

        // 转发请求体
        req.pipe(proxyReq);

        // 处理请求超时
        req.on('timeout', () => {
            console.error('请求超时');
            proxyReq.destroy();
            res.writeHead(408, CORS_HEADERS);
            res.end(JSON.stringify({
                error: '请求超时'
            }));
        });
    });

    // 错误处理
    server.on('error', (error) => {
        console.error('服务器错误:', error);
    });

    return server;
}

// 启动服务器
function startServer() {
    const server = createProxyServer();
    
    server.listen(PROXY_PORT, () => {
        console.log('🚀 WebDAV代理服务器已启动');
        console.log(`📍 监听端口: ${PROXY_PORT}`);
        console.log(`🎯 目标服务器: https://${TARGET_HOST}${TARGET_PATH}`);
        console.log(`🌐 本地访问地址: http://localhost:${PROXY_PORT}`);
        console.log('');
        console.log('📋 使用说明:');
        console.log('1. 在WebDAV应用中使用以下配置:');
        console.log(`   服务器地址: http://localhost:${PROXY_PORT}`);
        console.log('   用户名: 18867123055');
        console.log('   密码: 1x1v8bj1000dbj9o9s1ay9setkp4d8zg');
        console.log('   基础路径: /小鲸鱼');
        console.log('');
        console.log('2. 确保WebDAV应用在同一台机器上运行');
        console.log('3. 按 Ctrl+C 停止服务器');
        console.log('');
        console.log('🔍 日志信息:');
    });

    // 优雅关闭
    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭代理服务器...');
        server.close(() => {
            console.log('✅ 代理服务器已关闭');
            process.exit(0);
        });
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 收到终止信号，关闭服务器...');
        server.close(() => {
            console.log('✅ 代理服务器已关闭');
            process.exit(0);
        });
    });
}

// 如果直接运行此脚本
if (require.main === module) {
    startServer();
}

module.exports = { createProxyServer, startServer };