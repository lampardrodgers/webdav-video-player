/**
 * 流式WebDAV代理服务器 - 修复版
 * 支持Range请求的同时保持流式传输
 * 关键：边下载边发送，不缓冲完整文件
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PROXY_PORT = 8090;
const TARGET_HOST = 'webdav-1839857505.pd1.123pan.cn';
const TARGET_PATH = '/webdav';

// 请求跟踪
let requestCounter = 0;
const activeRequests = new Map();

// 全局统计
const globalStats = {
    totalRequests: 0,
    activeRequests: 0,
    totalBytesTransferred: 0,
    currentSpeed: 0,
    transferHistory: [], // 最近的传输记录
    rangeRequests: 0, // Range请求计数
    startTime: Date.now()
};

// 生成请求ID
function generateRequestId() {
    return `REQ_${++requestCounter}_${Date.now().toString(36)}`;
}

// 增强日志函数
function log(requestId, level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${requestId}] [${level.toUpperCase()}]`;
    
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

// 格式化字节数
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 更新传输统计
function updateTransferStats(bytes) {
    const now = Date.now();
    globalStats.totalBytesTransferred += bytes;
    
    // 记录传输历史（用于计算速度）
    globalStats.transferHistory.push({
        timestamp: now,
        bytes: bytes
    });
    
    // 保持最近10秒的历史记录
    const tenSecondsAgo = now - 10000;
    globalStats.transferHistory = globalStats.transferHistory.filter(
        record => record.timestamp > tenSecondsAgo
    );
    
    // 计算当前速度（字节/秒）
    if (globalStats.transferHistory.length > 1) {
        const totalBytes = globalStats.transferHistory.reduce((sum, record) => sum + record.bytes, 0);
        const timeSpan = now - globalStats.transferHistory[0].timestamp;
        globalStats.currentSpeed = timeSpan > 0 ? (totalBytes / timeSpan * 1000) : 0;
    }
}

// 获取统计信息
function getGlobalStats() {
    return {
        ...globalStats,
        activeRequests: activeRequests.size,
        uptime: Date.now() - globalStats.startTime,
        formattedSpeed: formatBytes(globalStats.currentSpeed) + '/s',
        formattedTotal: formatBytes(globalStats.totalBytesTransferred)
    };
}

// CORS头配置
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout, X-Requested-With, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type, Date, Last-Modified, ETag, Accept-Ranges, Content-Range',
    'Access-Control-Allow-Credentials': 'true'
};

// Range请求解析 - 改进版，支持多种格式
function parseRange(rangeHeader, totalSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const ranges = rangeHeader.substring(6).split(',');
    const range = ranges[0].trim();
    
    // 支持不同的Range格式：
    // bytes=0-1023    (标准格式)
    // bytes=1024-     (从某位置到文件末尾)
    // bytes=-1024     (文件最后1024字节)
    
    if (range.startsWith('-')) {
        // 处理 bytes=-1024 格式（后缀范围）
        const suffixLength = parseInt(range.substring(1));
        return {
            start: Math.max(0, totalSize - suffixLength),
            end: totalSize - 1
        };
    }
    
    const [start, end] = range.split('-');
    
    return {
        start: start ? parseInt(start) : 0,
        end: end !== '' ? parseInt(end) : totalSize - 1
    };
}

// 创建流式代理服务器
function createStreamingProxyServer() {
    const server = http.createServer(async (req, res) => {
        const requestId = generateRequestId();
        const parsedUrl = url.parse(req.url, true);
        
        // 记录请求开始
        activeRequests.set(requestId, {
            method: req.method,
            url: req.url,
            startTime: Date.now(),
            range: req.headers.range
        });
        
        log(requestId, 'info', `${req.method} ${req.url}${req.headers.range ? ' Range: ' + req.headers.range : ''}`);
        
        // 处理统计API请求
        if (req.url === '/api/stats') {
            res.writeHead(200, {
                ...CORS_HEADERS,
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify(getGlobalStats()));
            log(requestId, 'debug', '统计API请求完成');
            activeRequests.delete(requestId);
            return;
        }
        
        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200, CORS_HEADERS);
            res.end();
            log(requestId, 'info', 'OPTIONS请求完成');
            activeRequests.delete(requestId);
            return;
        }

        // 构建目标URL
        const targetUrl = `https://${TARGET_HOST}${TARGET_PATH}${parsedUrl.pathname}${parsedUrl.search || ''}`;
        log(requestId, 'debug', `目标URL: ${targetUrl}`);
        
        try {
            // 检查是否为视频文件的GET请求且有Range头
            const isVideoRequest = req.method === 'GET' && 
                                 (parsedUrl.pathname.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i));
            
            if (isVideoRequest && req.headers.range) {
                log(requestId, 'info', '处理视频Range请求');
                globalStats.rangeRequests++; // 增加Range请求计数
                await handleStreamingRangeRequest(req, res, targetUrl, requestId);
            } else {
                log(requestId, 'info', '处理常规请求');
                await handleRegularRequest(req, res, targetUrl, requestId);
            }
            
            // 计算请求时长
            const duration = Date.now() - activeRequests.get(requestId).startTime;
            log(requestId, 'info', `请求完成，耗时: ${duration}ms`);
            
        } catch (error) {
            log(requestId, 'error', `请求处理失败: ${error.message}`);
            if (!res.headersSent) {
                res.writeHead(500, CORS_HEADERS);
                res.end(JSON.stringify({
                    error: '代理服务器错误',
                    message: error.message,
                    requestId: requestId
                }));
            }
        } finally {
            activeRequests.delete(requestId);
        }
    });

    return server;
}

// 处理流式Range请求 - 关键：边下载边发送
async function handleStreamingRangeRequest(req, res, targetUrl, requestId) {
    const rangeHeader = req.headers.range;
    
    log(requestId, 'debug', `Range头: ${rangeHeader}`);
    
    // 首先获取文件总大小
    log(requestId, 'debug', '发起HEAD请求获取文件大小');
    const headResponse = await makeRequest('HEAD', targetUrl, req.headers);
    const totalSize = parseInt(headResponse.headers['content-length'] || '0');
    
    log(requestId, 'debug', `HEAD响应状态: ${headResponse.statusCode}, Content-Length: ${headResponse.headers['content-length']}`);
    
    if (totalSize === 0) {
        throw new Error('无法获取文件大小：Content-Length为0或未定义');
    }

    const range = parseRange(rangeHeader, totalSize);
    if (!range) {
        throw new Error('无效的Range请求');
    }

    const rangeSize = range.end - range.start + 1;
    log(requestId, 'info', `Range解析: ${range.start}-${range.end}/${totalSize} (${formatBytes(rangeSize)})`);
    
    // 记录Range请求开始
    activeRequests.get(requestId).range = range;
    activeRequests.get(requestId).totalSize = totalSize;

    // 尝试向上游发送Range请求
    const rangeHeaders = {
        ...req.headers,
        host: TARGET_HOST
    };
    delete rangeHeaders['origin'];
    delete rangeHeaders['referer'];

    try {
        log(requestId, 'debug', '向上游发起Range请求');
        const response = await makeRequest('GET', targetUrl, rangeHeaders);
        
        log(requestId, 'info', `上游响应状态: ${response.statusCode}`);
        
        // 如果上游支持Range且返回206
        if (response.statusCode === 206) {
            log(requestId, 'info', '上游服务器支持Range请求，直接流式传输');
            
            // 设置Range响应头
            const responseHeaders = {
                ...CORS_HEADERS,
                'Content-Range': response.headers['content-range'],
                'Content-Length': response.headers['content-length'],
                'Accept-Ranges': 'bytes',
                'Content-Type': response.headers['content-type'] || 'video/mp4'
            };

            res.writeHead(206, responseHeaders);
            
            // 关键：直接管道传输，不缓冲 - 添加传输监控
            let transferredBytes = 0;
            response.on('data', (chunk) => {
                transferredBytes += chunk.length;
                updateTransferStats(chunk.length); // 更新全局统计
                if (transferredBytes % (1024 * 1024) < chunk.length) {
                    log(requestId, 'debug', `传输进度: ${formatBytes(transferredBytes)}/${formatBytes(rangeSize)}`);
                }
            });
            
            response.pipe(res);
            
            response.on('end', () => {
                log(requestId, 'info', `Range流式传输完成: ${formatBytes(transferredBytes)}`);
            });
            
            response.on('error', (error) => {
                log(requestId, 'error', `流式传输错误: ${error.message}`);
                if (!res.headersSent) {
                    res.writeHead(500, CORS_HEADERS);
                }
                res.end();
            });
            
        } else if (response.statusCode === 302 || response.statusCode === 301) {
            // 处理重定向
            const redirectUrl = response.headers.location;
            log(requestId, 'info', `重定向到: ${redirectUrl}`);
            
            if (!redirectUrl) {
                throw new Error('重定向但未提供location头');
            }
            
            // 向重定向URL发起流式Range请求
            await handleRedirectRange(redirectUrl, range, totalSize, res, requestId);
            
        } else {
            // 上游不支持Range，使用流式部分下载
            log(requestId, 'info', `上游不支持Range (状态${response.statusCode})，代理服务器实现流式分片下载`);
            await handleStreamingPartialDownload(req, res, targetUrl, range, totalSize, requestId);
        }
        
    } catch (error) {
        log(requestId, 'error', `Range请求失败: ${error.message}`);
        
        // 如果302重定向失败，尝试流式部分下载
        if (error.message.includes('重定向')) {
            const response = await makeRequest('GET', targetUrl, {
                ...req.headers,
                host: TARGET_HOST,
                range: undefined // 移除range头获取重定向
            });
            
            if (response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                await handleRedirectRange(redirectUrl, range, totalSize, res, requestId);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }
}

// 处理重定向的流式Range请求
async function handleRedirectRange(redirectUrl, range, totalSize, res, requestId) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(redirectUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : require('http');
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Range': `bytes=${range.start}-${range.end}`
            }
        };
        
        log(requestId, 'info', `向CDN发起Range请求: ${range.start}-${range.end}`);
        
        const proxyReq = httpModule.request(options, (proxyRes) => {
            log(requestId, 'info', `CDN响应状态: ${proxyRes.statusCode}`);
            
            if (proxyRes.statusCode === 206) {
                // CDN支持Range请求，直接流式传输
                const responseHeaders = {
                    ...CORS_HEADERS,
                    'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
                    'Content-Length': (range.end - range.start + 1).toString(),
                    'Accept-Ranges': 'bytes',
                    'Content-Type': proxyRes.headers['content-type'] || 'video/mp4'
                };

                res.writeHead(206, responseHeaders);
                
                // 关键：直接管道传输 - 添加统计监控
                let transferredBytes = 0;
                proxyRes.on('data', (chunk) => {
                    transferredBytes += chunk.length;
                    updateTransferStats(chunk.length);
                });
                
                proxyRes.pipe(res);
                
                proxyRes.on('end', () => {
                    log(requestId, 'info', `CDN流式传输完成: ${formatBytes(transferredBytes)}`);
                    resolve();
                });
                
                proxyRes.on('error', reject);
                
            } else if (proxyRes.statusCode === 200) {
                // CDN不支持Range，需要流式跳过和截取
                log(requestId, 'info', `CDN不支持Range，实现流式跳过和截取`);
                
                const responseHeaders = {
                    ...CORS_HEADERS,
                    'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
                    'Content-Length': (range.end - range.start + 1).toString(),
                    'Accept-Ranges': 'bytes',
                    'Content-Type': proxyRes.headers['content-type'] || 'video/mp4'
                };

                res.writeHead(206, responseHeaders);
                
                let downloadedBytes = 0;
                let sentBytes = 0;
                const targetBytes = range.end - range.start + 1;
                
                proxyRes.on('data', chunk => {
                    const chunkStart = downloadedBytes;
                    const chunkEnd = downloadedBytes + chunk.length - 1;
                    
                    // 检查这个chunk是否包含我们需要的数据
                    if (chunkEnd >= range.start && chunkStart <= range.end && sentBytes < targetBytes) {
                        // 计算chunk中我们需要的部分
                        const useStart = Math.max(0, range.start - chunkStart);
                        const useEnd = Math.min(chunk.length - 1, range.end - chunkStart);
                        
                        if (useStart <= useEnd) {
                            const usefulPart = chunk.slice(useStart, useEnd + 1);
                            const remainingBytes = targetBytes - sentBytes;
                            const sendBytes = Math.min(usefulPart.length, remainingBytes);
                            
                            if (sendBytes > 0) {
                                // 关键：立即发送数据，不缓冲
                                res.write(usefulPart.slice(0, sendBytes));
                                sentBytes += sendBytes;
                                updateTransferStats(sendBytes); // 更新统计
                            }
                        }
                    }
                    
                    downloadedBytes += chunk.length;
                    
                    // 如果已经发送完所需数据，关闭连接
                    if (sentBytes >= targetBytes) {
                        log(requestId, 'info', `CDN流式传输完成: ${formatBytes(sentBytes)}`);
                        proxyRes.destroy();
                        res.end();
                        resolve();
                        return;
                    }
                    
                    // 如果已经超过需要的范围，停止下载
                    if (downloadedBytes > range.end) {
                        proxyRes.destroy();
                        res.end();
                        resolve();
                        return;
                    }
                });
                
                proxyRes.on('end', () => {
                    res.end();
                    resolve();
                });
                
                proxyRes.on('error', reject);
                
            } else {
                reject(new Error(`CDN重定向响应错误: ${proxyRes.statusCode}`));
            }
        });

        proxyReq.on('error', reject);
        proxyReq.end();
    });
}

// 处理流式部分下载（当上游完全不支持Range时）
async function handleStreamingPartialDownload(req, res, targetUrl, range, totalSize, requestId) {
    return new Promise((resolve, reject) => {
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
        
        log(requestId, 'info', `开始流式部分下载: ${range.start}-${range.end}`);
        
        const proxyReq = https.request(options, (proxyRes) => {
            log(requestId, 'info', `部分下载响应状态: ${proxyRes.statusCode}`);
            
            if (proxyRes.statusCode !== 200) {
                reject(new Error(`上游服务器返回 ${proxyRes.statusCode}`));
                return;
            }
            
            // 设置Range响应头
            const responseHeaders = {
                ...CORS_HEADERS,
                'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
                'Content-Length': (range.end - range.start + 1).toString(),
                'Accept-Ranges': 'bytes',
                'Content-Type': proxyRes.headers['content-type'] || 'video/mp4'
            };

            res.writeHead(206, responseHeaders);
            
            let downloadedBytes = 0;
            let sentBytes = 0;
            const targetBytes = range.end - range.start + 1;
            
            proxyRes.on('data', chunk => {
                const chunkStart = downloadedBytes;
                const chunkEnd = downloadedBytes + chunk.length - 1;
                
                // 检查这个chunk是否包含我们需要的数据
                if (chunkEnd >= range.start && chunkStart <= range.end && sentBytes < targetBytes) {
                    // 计算chunk中我们需要的部分
                    const useStart = Math.max(0, range.start - chunkStart);
                    const useEnd = Math.min(chunk.length - 1, range.end - chunkStart);
                    
                    if (useStart <= useEnd) {
                        const usefulPart = chunk.slice(useStart, useEnd + 1);
                        const remainingBytes = targetBytes - sentBytes;
                        const sendBytes = Math.min(usefulPart.length, remainingBytes);
                        
                        if (sendBytes > 0) {
                            // 关键：立即发送数据，不缓冲
                            res.write(usefulPart.slice(0, sendBytes));
                            sentBytes += sendBytes;
                            updateTransferStats(sendBytes); // 更新统计
                            
                            if (sentBytes % (1024 * 1024) < sendBytes) {
                                log(requestId, 'debug', `已发送: ${formatBytes(sentBytes)}/${formatBytes(targetBytes)}`);
                            }
                        }
                    }
                }
                
                downloadedBytes += chunk.length;
                
                // 如果已经发送完所需数据，关闭连接
                if (sentBytes >= targetBytes) {
                    log(requestId, 'info', `流式传输完成: ${formatBytes(sentBytes)}`);
                    proxyRes.destroy();
                    res.end();
                    resolve();
                    return;
                }
                
                // 如果已经超过需要的范围，停止下载
                if (downloadedBytes > range.end) {
                    proxyRes.destroy();
                    res.end();
                    resolve();
                    return;
                }
            });

            proxyRes.on('end', () => {
                res.end();
                resolve();
            });

            proxyRes.on('error', reject);
        });

        proxyReq.on('error', reject);
        proxyReq.end();
    });
}

// 处理常规请求
async function handleRegularRequest(req, res, targetUrl, requestId) {
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
        log(requestId, 'info', `代理响应: ${req.method} -> ${proxyRes.statusCode}`);
        
        const responseHeaders = {
            ...CORS_HEADERS,
            ...proxyRes.headers
        };

        // 为视频文件添加Range支持头
        if (req.method === 'GET' && req.url.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/i)) {
            responseHeaders['Accept-Ranges'] = 'bytes';
            log(requestId, 'debug', '添加Accept-Ranges支持');
        }

        res.writeHead(proxyRes.statusCode, responseHeaders);
        
        // 关键：直接管道传输
        proxyRes.pipe(res);
        
        // 添加传输监控
        let transferredBytes = 0;
        proxyRes.on('data', (chunk) => {
            transferredBytes += chunk.length;
            updateTransferStats(chunk.length); // 更新全局统计
        });
        
        proxyRes.on('end', () => {
            log(requestId, 'info', `常规传输完成: ${formatBytes(transferredBytes)}`);
        });
    });

    proxyReq.on('error', (error) => {
        log(requestId, 'error', `代理请求错误: ${error.message}`);
        if (!res.headersSent) {
            res.writeHead(500, CORS_HEADERS);
            res.end(JSON.stringify({
                error: '上游服务器错误',
                message: error.message,
                requestId: requestId
            }));
        }
    });

    req.pipe(proxyReq);
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

        const req = https.request(url, options, (response) => {
            // 对于HEAD请求，我们不需要读取响应体，直接resolve
            if (method === 'HEAD') {
                resolve(response);
                return;
            }
            
            // 对于其他请求，也直接resolve响应对象
            resolve(response);
        });
        
        req.on('error', (error) => {
            console.error(`[REQUEST ERROR] ${method} ${url} - ${error.message}`);
            reject(error);
        });
        
        req.end();
    });
}

// 启动流式服务器
function startStreamingServer() {
    const server = createStreamingProxyServer();
    
    server.listen(PROXY_PORT, () => {
        console.log('🚀 流式WebDAV代理服务器已启动');
        console.log(`📍 监听端口: ${PROXY_PORT}`);
        console.log(`🎯 目标服务器: https://${TARGET_HOST}${TARGET_PATH}`);
        console.log(`🌐 本地访问地址: http://localhost:${PROXY_PORT}`);
        console.log('');
        console.log('✨ 核心功能:');
        console.log('  - 真正的流式传输 (边下载边播放)');
        console.log('  - Range请求支持 (视频快进/跳转)');
        console.log('  - 302重定向处理');
        console.log('  - 实时数据传输 (无缓冲)');
        console.log('');
        console.log('⚠️  停止服务器: 按 Ctrl+C');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

    // 优雅关闭
    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭流式代理服务器...');
        server.close(() => {
            console.log('✅ 服务器已关闭');
            process.exit(0);
        });
    });

    return server;
}

// 如果直接运行此脚本
if (require.main === module) {
    startStreamingServer();
}

module.exports = { startStreamingServer, createStreamingProxyServer };