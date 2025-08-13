/**
 * WebDAV备用实现
 * 当主要的WebDAV库无法加载时使用
 */

class FallbackWebDAVClient {
    constructor(url, options = {}) {
        this.baseURL = url.replace(/\/$/, '');
        this.username = options.username;
        this.password = options.password;
        this.headers = {
            'Authorization': `Basic ${btoa(`${this.username}:${this.password}`)}`,
            'User-Agent': options.headers?.['User-Agent'] || 'WebDAV-Fallback-Client/1.0',
            ...options.headers
        };
    }

    async getDirectoryContents(path, options = {}) {
        try {
            const url = `${this.baseURL}${path}`;
            logger.debug(`WebDAV PROPFIND请求: ${url}`);
            
            const requestOptions = {
                method: 'PROPFIND',
                headers: {
                    ...this.headers,
                    'Depth': options.deep ? 'infinity' : '1',
                    'Content-Type': 'application/xml; charset=utf-8'
                },
                mode: 'cors', // 明确指定CORS模式
                credentials: 'include', // 包含认证信息
                body: `<?xml version="1.0" encoding="utf-8" ?>
                    <d:propfind xmlns:d="DAV:">
                        <d:prop>
                            <d:displayname/>
                            <d:getcontentlength/>
                            <d:getcontenttype/>
                            <d:getlastmodified/>
                            <d:resourcetype/>
                        </d:prop>
                    </d:propfind>`
            };

            logger.debug('发送PROPFIND请求', { url, headers: requestOptions.headers });
            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                throw new Error(`WebDAV请求失败: ${response.status} ${response.statusText}`);
            }

            const xmlText = await response.text();
            return this.parseWebDAVResponse(xmlText, path);
        } catch (error) {
            logger.error('WebDAV PROPFIND请求失败', { 
                error: error.message, 
                path: path 
            });
            throw error;
        }
    }

    async stat(path, options = {}) {
        try {
            const url = `${this.baseURL}${path}`;
            const response = await fetch(url, {
                method: 'PROPFIND',
                headers: {
                    ...this.headers,
                    'Depth': '0',
                    'Content-Type': 'application/xml; charset=utf-8'
                },
                body: `<?xml version="1.0" encoding="utf-8" ?>
                    <d:propfind xmlns:d="DAV:">
                        <d:prop>
                            <d:displayname/>
                            <d:getcontentlength/>
                            <d:getcontenttype/>
                            <d:getlastmodified/>
                            <d:resourcetype/>
                        </d:prop>
                    </d:propfind>`
            });

            if (!response.ok) {
                throw new Error(`WebDAV STAT请求失败: ${response.status} ${response.statusText}`);
            }

            const xmlText = await response.text();
            const items = this.parseWebDAVResponse(xmlText, path);
            return items.find(item => item.filename === path) || items[0];
        } catch (error) {
            logger.error('WebDAV STAT请求失败', { 
                error: error.message, 
                path: path 
            });
            throw error;
        }
    }

    parseWebDAVResponse(xmlText, basePath) {
        try {
            // 创建一个简单的XML解析器
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            
            const responses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
            const items = [];

            for (let i = 0; i < responses.length; i++) {
                const response = responses[i];
                const href = response.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent;
                
                if (!href) continue;

                // 解码URL
                let decodedPath;
                try {
                    decodedPath = decodeURIComponent(href);
                } catch {
                    decodedPath = href;
                }

                // 获取属性
                const propstat = response.getElementsByTagNameNS('DAV:', 'propstat')[0];
                if (!propstat) continue;

                const prop = propstat.getElementsByTagNameNS('DAV:', 'prop')[0];
                if (!prop) continue;

                const displayname = prop.getElementsByTagNameNS('DAV:', 'displayname')[0]?.textContent || '';
                const contentLength = prop.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent || '0';
                const contentType = prop.getElementsByTagNameNS('DAV:', 'getcontenttype')[0]?.textContent || '';
                const lastModified = prop.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent || '';
                const resourceType = prop.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
                
                // 判断是否为目录
                const isCollection = resourceType?.getElementsByTagNameNS('DAV:', 'collection').length > 0;

                const item = {
                    filename: decodedPath,
                    basename: displayname || decodedPath.split('/').pop() || '',
                    lastmod: lastModified ? new Date(lastModified) : new Date(),
                    size: parseInt(contentLength, 10) || 0,
                    type: isCollection ? 'directory' : 'file',
                    mime: contentType || 'application/octet-stream'
                };

                items.push(item);
            }

            return items;
        } catch (error) {
            logger.error('解析WebDAV响应失败', { error: error.message });
            throw new Error('WebDAV响应解析失败: ' + error.message);
        }
    }
}

// 创建备用WebDAV客户端工厂
window.webdavFallback = {
    createClient: function(url, options) {
        return new FallbackWebDAVClient(url, options);
    },
    AuthType: {
        Password: 'password'
    }
};

// 如果主WebDAV库不可用，使用备用实现
function ensureWebDAVLibrary() {
    if (!window.webdav || typeof window.webdav.createClient !== 'function') {
        console.warn('主WebDAV库不可用，切换到备用实现');
        window.webdav = window.webdavFallback;
        
        // 在日志中记录
        if (window.logger) {
            logger.warn('WebDAV库切换到备用实现', {
                reason: '主库不可用',
                fallbackFeatures: ['PROPFIND', 'Basic Auth', 'Directory listing']
            });
        }
        
        return false; // 表示使用了备用实现
    }
    return true; // 表示使用了原始库
}

// 导出检查函数
window.ensureWebDAVLibrary = ensureWebDAVLibrary;