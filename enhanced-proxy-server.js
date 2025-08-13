/**
 * 增强版WebDAV代理服务器
 * 支持Range请求、视频缓存、实时监控
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PROXY_PORT = 8090;
const TARGET_HOST = 'webdav-1839857505.pd1.123pan.cn';
const TARGET_PATH = '/webdav';
const CACHE_DIR = path.join(__dirname, 'video-cache');
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB

// CORS头配置
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout, X-Requested-With, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Date, Last-Modified, ETag, Accept-Ranges, Content-Range',
    'Access-Control-Allow-Credentials': 'true'
};

// 缓存管理
class VideoCache {
    constructor() {
        this.cache = new Map();
        this.cacheSize = 0;
        this.stats = {
            hits: 0,
            misses: 0,
            totalRequests: 0
        };
        
        // 确保缓存目录存在
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
    }

    getCacheKey(url, range) {
        const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '');
        const rangeStr = range ? `-${range.start}-${range.end}` : '';
        return `${urlHash}${rangeStr}`;
    }

    has(url, range) {
        const key = this.getCacheKey(url, range);
        return this.cache.has(key);
    }

    get(url, range) {
        const key = this.getCacheKey(url, range);
        if (this.cache.has(key)) {
            this.stats.hits++;
            const entry = this.cache.get(key);
            entry.lastAccess = Date.now();
            return entry;
        }
        this.stats.misses++;
        return null;
    }

    set(url, range, data, headers) {
        const key = this.getCacheKey(url, range);
        const entry = {
            data: data,
            headers: headers,
            timestamp: Date.now(),
            lastAccess: Date.now(),
            size: data.length
        };

        // 检查缓存大小限制
        if (this.cacheSize + entry.size > MAX_CACHE_SIZE) {
            this.cleanup();
        }

        this.cache.set(key, entry);
        this.cacheSize += entry.size;
        
        console.log(`[CACHE] 缓存片段: ${key}, 大小: ${this.formatSize(entry.size)}, 总缓存: ${this.formatSize(this.cacheSize)}`);
    }

    cleanup() {
        // 清理最久未使用的缓存项
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

        const targetSize = MAX_CACHE_SIZE * 0.7; // 清理到70%
        while (this.cacheSize > targetSize && entries.length > 0) {
            const [key, entry] = entries.shift();
            this.cache.delete(key);
            this.cacheSize -= entry.size;
            console.log(`[CACHE] 清理缓存: ${key}, 释放: ${this.formatSize(entry.size)}`);
        }
    }

    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    getStats() {
        this.stats.totalRequests = this.stats.hits + this.stats.misses;
        this.stats.hitRate = this.stats.totalRequests > 0 ? 
            ((this.stats.hits / this.stats.totalRequests) * 100).toFixed(2) : 0;
        this.stats.cacheSize = this.formatSize(this.cacheSize);
        this.stats.entries = this.cache.size;
        return this.stats;
    }
}

// Range请求解析
function parseRange(rangeHeader, totalSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const ranges = rangeHeader.substring(6).split(',');
    const range = ranges[0].trim();
    const [start, end] = range.split('-');

    return {
        start: start ? parseInt(start) : 0,
        end: end ? parseInt(end) : totalSize - 1
    };
}

// 创建增强代理服务器
function createEnhancedProxyServer() {
    const cache = new VideoCache();
    
    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] ${req.method} ${req.url}${req.headers.range ? ' (Range: ' + req.headers.range + ')' : ''}`);
        
        // 处理统计端点
        if (req.url === '/stats') {
            res.writeHead(200, {
                ...CORS_HEADERS,
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify(cache.getStats(), null, 2));
            return;
        }
        
        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200, CORS_HEADERS);
            res.end();
            return;
        }

        // 构建目标URL
        const targetUrl = `https://${TARGET_HOST}${TARGET_PATH}${parsedUrl.pathname}${parsedUrl.search || ''}`;
        
        try {
            // 检查是否为视频文件的GET请求
            const isVideoRequest = req.method === 'GET' && 
                                 (parsedUrl.pathname.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i));
            
            if (isVideoRequest && req.headers.range) {
                await handleRangeRequest(req, res, targetUrl, cache);
            } else {
                await handleRegularRequest(req, res, targetUrl, cache);
            }
        } catch (error) {
            console.error(`[ERROR] 请求处理失败: ${error.message}`);
            res.writeHead(500, CORS_HEADERS);
            res.end(JSON.stringify({
                error: '代理服务器错误',
                message: error.message,
                timestamp: timestamp
            }));
        }
    });


    return server;
}

// 处理Range请求
async function handleRangeRequest(req, res, targetUrl, cache) {
    const rangeHeader = req.headers.range;
    
    // 首先获取文件总大小
    const headResponse = await makeRequest('HEAD', targetUrl, req.headers);
    const totalSize = parseInt(headResponse.headers['content-length'] || '0');
    
    if (totalSize === 0) {
        throw new Error('无法获取文件大小');
    }

    const range = parseRange(rangeHeader, totalSize);
    if (!range) {
        throw new Error('无效的Range请求');
    }

    console.log(`[RANGE] 请求范围: ${range.start}-${range.end}/${totalSize} (${((range.end - range.start + 1) / 1024 / 1024).toFixed(2)} MB)`);

    // 检查缓存
    const cachedData = cache.get(targetUrl, range);
    if (cachedData) {
        console.log(`[CACHE HIT] 使用缓存数据`);
        sendRangeResponse(res, cachedData.data, range, totalSize, cachedData.headers);
        return;
    }

    // 从上游服务器获取完整文件并提取范围
    console.log(`[CACHE MISS] 从上游服务器获取数据，实现Range分片`);
    
    try {
        // 先尝试发送Range请求给上游
        const rangeHeaders = {
            ...req.headers,
            'Range': `bytes=${range.start}-${range.end}`
        };
        delete rangeHeaders['origin'];
        delete rangeHeaders['referer'];
        rangeHeaders.host = TARGET_HOST;

        const response = await makeRequest('GET', targetUrl, rangeHeaders);
        
        // 如果上游返回206，直接使用
        if (response.statusCode === 206) {
            console.log(`[UPSTREAM] 上游服务器支持Range请求`);
            const chunks = [];
            
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const data = Buffer.concat(chunks);
                cache.set(targetUrl, range, data, response.headers);
                sendRangeResponse(res, data, range, totalSize, response.headers);
            });
        } else {
            // 上游不支持Range，我们自己实现
            console.log(`[PROXY RANGE] 上游不支持Range，代理服务器实现分片下载`);
            await handlePartialDownload(req, res, targetUrl, range, totalSize, cache);
        }
    } catch (error) {
        console.error(`[RANGE ERROR] Range请求失败，尝试部分下载: ${error.message}`);
        await handlePartialDownload(req, res, targetUrl, range, totalSize, cache);
    }
}

// 处理部分下载（当上游不支持Range时）
async function handlePartialDownload(req, res, targetUrl, range, totalSize, cache) {
    const headers = { ...req.headers };
    delete headers['range']; // 移除Range头，下载完整文件
    delete headers['origin'];
    delete headers['referer'];
    headers.host = TARGET_HOST;

    const response = await makeRequest('GET', targetUrl, headers);
    
    let downloadedBytes = 0;
    let buffer = Buffer.alloc(0);
    const targetBytes = range.end - range.start + 1;
    
    console.log(`[PARTIAL] 开始部分下载: ${range.start}-${range.end}, 目标大小: ${targetBytes} bytes`);

    response.on('data', chunk => {
        const chunkStart = downloadedBytes;
        const chunkEnd = downloadedBytes + chunk.length - 1;
        
        // 检查这个chunk是否包含我们需要的数据
        if (chunkEnd >= range.start && chunkStart <= range.end) {
            // 计算chunk中我们需要的部分
            const useStart = Math.max(0, range.start - chunkStart);
            const useEnd = Math.min(chunk.length - 1, range.end - chunkStart);
            
            if (useStart <= useEnd) {
                const usefulPart = chunk.slice(useStart, useEnd + 1);
                buffer = Buffer.concat([buffer, usefulPart]);
                
                console.log(`[PARTIAL] 收集数据: ${buffer.length}/${targetBytes} bytes (${((buffer.length/targetBytes)*100).toFixed(1)}%)`);
            }
        }
        
        downloadedBytes += chunk.length;
        
        // 如果已经收集到足够的数据，停止下载
        if (buffer.length >= targetBytes) {
            response.destroy(); // 停止下载
        }
    });

    response.on('end', () => {
        if (buffer.length > 0) {
            console.log(`[PARTIAL] 下载完成: ${buffer.length} bytes`);
            
            // 缓存数据
            cache.set(targetUrl, range, buffer, response.headers);
            
            // 发送响应
            sendRangeResponse(res, buffer, range, totalSize, response.headers);
        } else {
            throw new Error('未能获取到请求范围的数据');
        }
    });

    response.on('error', (error) => {
        throw new Error(`部分下载失败: ${error.message}`);
    });
}

// 处理常规请求
async function handleRegularRequest(req, res, targetUrl, cache) {
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

    const proxyReq = https.request(targetUrl, options, (proxyRes) => {
        console.log(`[PROXY] ${req.method} ${targetUrl} -> ${proxyRes.statusCode}`);
        
        const responseHeaders = {
            ...CORS_HEADERS,
            ...proxyRes.headers
        };

        // 添加Range支持头
        if (req.method === 'GET' && req.url.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i)) {
            responseHeaders['Accept-Ranges'] = 'bytes';
        }

        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
        console.error('[PROXY ERROR]', error.message);
        res.writeHead(500, CORS_HEADERS);
        res.end(JSON.stringify({
            error: '上游服务器错误',
            message: error.message
        }));
    });

    req.pipe(proxyReq);
}

// 发送Range响应
function sendRangeResponse(res, data, range, totalSize, originalHeaders) {
    const responseHeaders = {
        ...CORS_HEADERS,
        'Content-Length': data.length,
        'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': originalHeaders['content-type'] || 'video/mp4'
    };

    res.writeHead(206, responseHeaders);
    res.end(data);
}

// 辅助函数：发起HTTP请求
function makeRequest(method, url, headers) {
    return new Promise((resolve, reject) => {
        const options = {
            method,
            headers: {
                ...headers,
                host: TARGET_HOST
            }
        };

        delete options.headers['origin'];
        delete options.headers['referer'];

        const req = https.request(url, options, resolve);
        req.on('error', reject);
        req.end();
    });
}

// 启动增强服务器
function startEnhancedServer() {
    const server = createEnhancedProxyServer();
    
    server.listen(PROXY_PORT, () => {
        console.log('🚀 增强版WebDAV代理服务器已启动');
        console.log(`📍 监听端口: ${PROXY_PORT}`);
        console.log(`🎯 目标服务器: https://${TARGET_HOST}${TARGET_PATH}`);
        console.log(`🌐 本地访问地址: http://localhost:${PROXY_PORT}`);
        console.log(`📊 统计信息: http://localhost:${PROXY_PORT}/stats`);
        console.log('');
        console.log('✨ 新功能:');
        console.log('  - Range请求支持 (视频快进/跳转)');
        console.log('  - 智能缓存机制 (500MB缓存)');
        console.log('  - 实时性能统计');
        console.log('  - 详细日志记录');
        console.log('');
        console.log('⚠️  停止服务器: 按 Ctrl+C');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

    // 优雅关闭
    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭增强版代理服务器...');
        server.close(() => {
            console.log('✅ 服务器已关闭');
            process.exit(0);
        });
    });

    return server;
}

// 如果直接运行此脚本
if (require.main === module) {
    startEnhancedServer();
}

module.exports = { startEnhancedServer, createEnhancedProxyServer };