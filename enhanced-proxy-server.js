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
const SEGMENT_SIZE = 2 * 1024 * 1024; // 2MB per segment

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
        if (range) {
            // 对于Range请求，使用分段键
            const segmentStart = Math.floor(range.start / SEGMENT_SIZE) * SEGMENT_SIZE;
            const segmentEnd = Math.min(segmentStart + SEGMENT_SIZE - 1, range.end);
            return `${urlHash}-seg-${segmentStart}-${segmentEnd}`;
        }
        return `${urlHash}`;
    }

    // 获取分段范围
    getSegmentRange(range) {
        const segmentStart = Math.floor(range.start / SEGMENT_SIZE) * SEGMENT_SIZE;
        const segmentEnd = segmentStart + SEGMENT_SIZE - 1;
        return { start: segmentStart, end: segmentEnd };
    }

    // 检查是否有可合并的相邻分段
    findAdjacentSegments(url, range) {
        const segments = [];
        const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '');
        
        for (const [key, entry] of this.cache.entries()) {
            if (key.startsWith(`${urlHash}-seg-`)) {
                const match = key.match(/-seg-(\d+)-(\d+)$/);
                if (match) {
                    const segStart = parseInt(match[1]);
                    const segEnd = parseInt(match[2]);
                    
                    // 检查是否与请求范围重叠或相邻
                    if (segEnd >= range.start - SEGMENT_SIZE && segStart <= range.end + SEGMENT_SIZE) {
                        segments.push({
                            key,
                            start: segStart,
                            end: segEnd,
                            data: entry.data
                        });
                    }
                }
            }
        }
        
        return segments.sort((a, b) => a.start - b.start);
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

    // 检查分段缓存
    const segments = cache.findAdjacentSegments(targetUrl, range);
    if (segments.length > 0) {
        console.log(`[CACHE] 找到 ${segments.length} 个相关缓存分段`);
        
        // 尝试从缓存分段中组合数据
        const cachedData = tryBuildFromSegments(segments, range);
        if (cachedData) {
            console.log(`[CACHE HIT] 从分段缓存构建响应`);
            sendRangeResponse(res, cachedData, range, totalSize, headResponse.headers);
            return;
        }
    }

    // 检查精确缓存匹配
    const cachedData = cache.get(targetUrl, range);
    if (cachedData) {
        console.log(`[CACHE HIT] 使用精确缓存数据`);
        sendRangeResponse(res, cachedData.data, range, totalSize, cachedData.headers);
        return;
    }

    // 从上游服务器获取数据
    console.log(`[CACHE MISS] 从上游服务器获取数据`);
    
    try {
        // 优化：如果请求范围小于一个分段，下载整个分段
        const segmentRange = cache.getSegmentRange(range);
        const downloadRange = (range.end - range.start + 1 < SEGMENT_SIZE / 2) ? segmentRange : range;
        
        console.log(`[DOWNLOAD] 优化下载范围: ${downloadRange.start}-${downloadRange.end} (原请求: ${range.start}-${range.end})`);
        
        // 先尝试发送Range请求给上游
        const rangeHeaders = {
            ...req.headers,
            'Range': `bytes=${downloadRange.start}-${downloadRange.end}`
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
                
                // 缓存下载的分段
                cache.set(targetUrl, downloadRange, data, response.headers);
                
                // 从下载的数据中提取请求的部分
                const startOffset = range.start - downloadRange.start;
                const endOffset = startOffset + (range.end - range.start);
                const responseData = data.slice(startOffset, endOffset + 1);
                
                sendRangeResponse(res, responseData, range, totalSize, response.headers);
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

// 尝试从分段缓存中构建响应数据
function tryBuildFromSegments(segments, range) {
    if (segments.length === 0) return null;
    
    // 检查分段是否覆盖了完整的请求范围
    segments.sort((a, b) => a.start - b.start);
    
    let currentPos = range.start;
    let buffers = [];
    
    for (const segment of segments) {
        // 如果有缺口，无法构建完整响应
        if (segment.start > currentPos) {
            console.log(`[CACHE] 分段缺口: ${currentPos} -> ${segment.start}`);
            return null;
        }
        
        // 如果分段覆盖了当前位置
        if (segment.end >= currentPos) {
            const useStart = Math.max(0, currentPos - segment.start);
            const useEnd = Math.min(segment.data.length - 1, range.end - segment.start);
            
            if (useStart <= useEnd) {
                buffers.push(segment.data.slice(useStart, useEnd + 1));
                currentPos = segment.start + useEnd + 1;
            }
        }
        
        // 如果已经覆盖了完整范围
        if (currentPos > range.end) {
            break;
        }
    }
    
    // 检查是否覆盖了完整范围
    if (currentPos <= range.end) {
        console.log(`[CACHE] 分段不完整: 覆盖到 ${currentPos}, 需要到 ${range.end}`);
        return null;
    }
    
    console.log(`[CACHE] 成功从 ${buffers.length} 个分段构建响应`);
    return Buffer.concat(buffers);
}

// 处理部分下载（当上游不支持Range时）
async function handlePartialDownload(req, res, targetUrl, range, totalSize, cache) {
    return new Promise((resolve, reject) => {
        const url = require('url');
        const parsedUrl = url.parse(targetUrl);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                ...req.headers,
                host: TARGET_HOST
            }
        };
        
        // 移除可能引起问题的头部
        delete options.headers['range'];
        delete options.headers['origin'];
        delete options.headers['referer'];
        
        console.log(`[PARTIAL] 开始部分下载: ${range.start}-${range.end}, 目标大小: ${range.end - range.start + 1} bytes`);
        
        const proxyReq = https.request(options, (proxyRes) => {
            console.log(`[PARTIAL] 响应状态: ${proxyRes.statusCode}`);
            
            // 处理重定向
            if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
                const redirectUrl = proxyRes.headers.location;
                console.log(`[PARTIAL] 重定向到: ${redirectUrl}`);
                
                if (!redirectUrl) {
                    reject(new Error('重定向但未提供location头'));
                    return;
                }
                
                // 递归处理重定向
                handleRedirect(redirectUrl, range, totalSize, cache)
                    .then(result => {
                        sendRangeResponse(res, result.buffer, range, totalSize, result.headers);
                        resolve();
                    })
                    .catch(reject);
                return;
            }
            
            if (proxyRes.statusCode !== 200) {
                reject(new Error(`上游服务器返回 ${proxyRes.statusCode}`));
                return;
            }
            
            let downloadedBytes = 0;
            let buffer = Buffer.alloc(0);
            const targetBytes = range.end - range.start + 1;
            
            proxyRes.on('data', chunk => {
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
                        
                        if (buffer.length % (1024 * 1024) < usefulPart.length) {
                            console.log(`[PARTIAL] 收集数据: ${(buffer.length / 1024 / 1024).toFixed(1)}MB/${(targetBytes / 1024 / 1024).toFixed(1)}MB (${((buffer.length/targetBytes)*100).toFixed(1)}%)`);
                        }
                    }
                }
                
                downloadedBytes += chunk.length;
                
                // 如果已经收集到完整范围数据，停止下载
                if (buffer.length >= targetBytes) {
                    console.log(`[PARTIAL] 已收集到完整范围数据，停止下载`);
                    proxyRes.destroy();
                    
                    // 缓存数据
                    cache.set(targetUrl, range, buffer, proxyRes.headers);
                    
                    // 发送响应
                    sendRangeResponse(res, buffer, range, totalSize, proxyRes.headers);
                    resolve();
                    return;
                }
                
                // 如果已经超过了需要的范围，也停止下载
                if (downloadedBytes > range.end) {
                    console.log(`[PARTIAL] 已超过目标范围，停止下载`);
                    proxyRes.destroy();
                    
                    if (buffer.length > 0) {
                        // 缓存数据
                        cache.set(targetUrl, range, buffer, proxyRes.headers);
                        
                        // 发送响应
                        sendRangeResponse(res, buffer, range, totalSize, proxyRes.headers);
                        resolve();
                    } else {
                        reject(new Error('未能获取到请求范围的数据'));
                    }
                    return;
                }
            });

            proxyRes.on('end', () => {
                if (buffer.length > 0) {
                    console.log(`[PARTIAL] 下载完成: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
                    
                    // 缓存数据
                    cache.set(targetUrl, range, buffer, proxyRes.headers);
                    
                    // 发送响应
                    sendRangeResponse(res, buffer, range, totalSize, proxyRes.headers);
                    resolve();
                } else {
                    reject(new Error('未能获取到请求范围的数据'));
                }
            });

            proxyRes.on('error', (error) => {
                reject(new Error(`部分下载失败: ${error.message}`));
            });
        });

        proxyReq.on('error', (error) => {
            reject(new Error(`请求失败: ${error.message}`));
        });

        // 发送请求
        proxyReq.end();
    });
}

// 处理重定向请求
async function handleRedirect(redirectUrl, range, totalSize, cache) {
    return new Promise((resolve, reject) => {
        const url = require('url');
        const parsedUrl = url.parse(redirectUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : require('http');
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
        
        console.log(`[REDIRECT] 请求重定向URL: ${redirectUrl}`);
        
        const proxyReq = httpModule.request(options, (proxyRes) => {
            console.log(`[REDIRECT] 重定向响应状态: ${proxyRes.statusCode}`);
            
            if (proxyRes.statusCode !== 200) {
                reject(new Error(`重定向响应错误: ${proxyRes.statusCode}`));
                return;
            }
            
            let downloadedBytes = 0;
            let buffer = Buffer.alloc(0);
            const targetBytes = range.end - range.start + 1;
            
            proxyRes.on('data', chunk => {
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
                        
                        if (buffer.length % (1024 * 1024) < usefulPart.length) {
                            console.log(`[REDIRECT] 收集数据: ${(buffer.length / 1024 / 1024).toFixed(1)}MB/${(targetBytes / 1024 / 1024).toFixed(1)}MB (${((buffer.length/targetBytes)*100).toFixed(1)}%)`);
                        }
                    }
                }
                
                downloadedBytes += chunk.length;
                
                // 如果已经收集到完整范围数据，停止下载
                if (buffer.length >= targetBytes) {
                    console.log(`[REDIRECT] 已收集到完整范围数据，停止下载`);
                    proxyRes.destroy();
                    
                    // 缓存数据
                    cache.set('redirect_' + redirectUrl, range, buffer, proxyRes.headers);
                    
                    resolve({
                        buffer: buffer,
                        headers: proxyRes.headers
                    });
                    return;
                }
                
                // 如果已经超过了需要的范围，也停止下载
                if (downloadedBytes > range.end) {
                    console.log(`[REDIRECT] 已超过目标范围，停止下载`);
                    proxyRes.destroy();
                    
                    if (buffer.length > 0) {
                        // 缓存数据
                        cache.set('redirect_' + redirectUrl, range, buffer, proxyRes.headers);
                        
                        resolve({
                            buffer: buffer,
                            headers: proxyRes.headers
                        });
                    } else {
                        reject(new Error('重定向：未能获取到请求范围的数据'));
                    }
                    return;
                }
            });

            proxyRes.on('end', () => {
                if (buffer.length > 0) {
                    console.log(`[REDIRECT] 下载完成: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
                    
                    // 缓存数据
                    cache.set('redirect_' + redirectUrl, range, buffer, proxyRes.headers);
                    
                    resolve({
                        buffer: buffer,
                        headers: proxyRes.headers
                    });
                } else {
                    reject(new Error('重定向：未能获取到请求范围的数据'));
                }
            });

            proxyRes.on('error', (error) => {
                reject(new Error(`重定向下载失败: ${error.message}`));
            });
        });

        proxyReq.on('error', (error) => {
            reject(new Error(`重定向请求失败: ${error.message}`));
        });

        // 发送请求
        proxyReq.end();
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