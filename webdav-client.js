/**
 * WebDAV客户端管理类
 * 处理WebDAV连接、认证、文件操作等
 */
class WebDAVClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.config = {
            serverUrl: '',
            username: '',
            password: '',
            basePath: '/'
        };
        this.currentPath = '/';
        this.fileCache = new Map();
        this.usingFallback = false;
        
        // 确保WebDAV库可用
        if (window.ensureWebDAVLibrary) {
            this.usingFallback = !window.ensureWebDAVLibrary();
        }
        
        logger.debug('WebDAV客户端已初始化', { 
            usingFallback: this.usingFallback 
        });
    }

    /**
     * 连接到WebDAV服务器
     */
    async connect(serverUrl, username, password, basePath = '/') {
        const startTime = Date.now();
        
        try {
            logger.info('正在连接WebDAV服务器...', {
                serverUrl: serverUrl,
                username: username,
                basePath: basePath
            });

            // 检查WebDAV库是否可用
            if (!window.webdav) {
                throw new Error('WebDAV客户端库未加载，请刷新页面重试');
            }

            if (typeof window.webdav.createClient !== 'function') {
                throw new Error('WebDAV库版本不兼容，请检查库文件');
            }

            // 清理URL
            serverUrl = this.normalizeUrl(serverUrl);
            basePath = this.normalizePath(basePath);

            // 保存配置
            this.config = {
                serverUrl,
                username,
                password,
                basePath
            };

            // 创建WebDAV客户端
            try {
                this.client = window.webdav.createClient(serverUrl, {
                    username: username,
                    password: password,
                    authType: window.webdav.AuthType.Password,
                    headers: {
                        'User-Agent': 'WebDAV-Video-Player/1.0'
                    }
                });
            } catch (clientError) {
                throw new Error(`创建WebDAV客户端失败: ${clientError.message}`);
            }

            // 测试连接
            await this.testConnection();
            
            this.isConnected = true;
            this.currentPath = basePath;
            
            const duration = Date.now() - startTime;
            logger.logPerformance('WebDAV连接', duration);
            logger.info('WebDAV服务器连接成功');
            
            return true;
        } catch (error) {
            this.isConnected = false;
            this.client = null;
            
            const duration = Date.now() - startTime;
            logger.logPerformance('WebDAV连接失败', duration);
            logger.error('WebDAV服务器连接失败', {
                error: error.message,
                serverUrl: serverUrl
            });
            
            throw error;
        }
    }

    /**
     * 测试WebDAV连接
     */
    async testConnection() {
        try {
            // 尝试列出根目录
            await this.client.getDirectoryContents(this.config.basePath);
            logger.debug('WebDAV连接测试通过');
        } catch (error) {
            logger.error('WebDAV连接测试失败', { error: error.message });
            throw new Error(`连接测试失败: ${error.message}`);
        }
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.isConnected = false;
        this.client = null;
        this.currentPath = '/';
        this.fileCache.clear();
        
        logger.info('已断开WebDAV服务器连接');
    }

    /**
     * 获取目录内容
     */
    async getDirectoryContents(path = null) {
        if (!this.isConnected) {
            throw new Error('未连接到WebDAV服务器');
        }

        const targetPath = path || this.currentPath;
        const startTime = Date.now();

        try {
            logger.debug(`获取目录内容: ${targetPath}`);
            
            const contents = await this.client.getDirectoryContents(targetPath, {
                deep: false,
                details: true
            });

            const duration = Date.now() - startTime;
            logger.logPerformance('目录内容获取', duration, {
                path: targetPath,
                fileCount: contents.length
            });

            // 处理和分类文件
            const processedContents = this.processDirectoryContents(contents, targetPath);
            
            // 缓存结果
            this.fileCache.set(targetPath, {
                contents: processedContents,
                timestamp: Date.now()
            });

            logger.logWebDAVOperation('目录列表', targetPath, 'success', {
                fileCount: processedContents.files.length,
                folderCount: processedContents.folders.length
            });

            return processedContents;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.logPerformance('目录内容获取失败', duration);
            logger.logWebDAVOperation('目录列表', targetPath, 'failed', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * 处理目录内容
     */
    processDirectoryContents(contents, currentPath) {
        const folders = [];
        const files = [];
        const videoFiles = [];

        contents.forEach(item => {
            // 跳过当前目录
            if (item.filename === currentPath) {
                return;
            }

            const itemInfo = {
                name: this.getBaseName(item.filename),
                path: item.filename,
                size: item.size || 0,
                lastmod: item.lastmod,
                type: item.type,
                mime: item.mime
            };

            if (item.type === 'directory') {
                folders.push({
                    ...itemInfo,
                    icon: '📁'
                });
            } else {
                files.push({
                    ...itemInfo,
                    icon: this.getFileIcon(item.filename, item.mime),
                    formattedSize: this.formatFileSize(item.size)
                });

                // 检查是否为视频文件
                if (this.isVideoFile(item.filename, item.mime)) {
                    videoFiles.push(itemInfo);
                }
            }
        });

        // 排序
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        return {
            folders,
            files,
            videoFiles,
            all: [...folders, ...files]
        };
    }

    /**
     * 获取文件流URL
     */
    getFileStreamUrl(filePath) {
        if (!this.isConnected) {
            throw new Error('未连接到WebDAV服务器');
        }

        // 构建完整的文件URL
        const baseUrl = this.config.serverUrl.replace(/\/$/, '');
        const cleanPath = filePath.replace(/^\//, '');
        const fullUrl = `${baseUrl}/${cleanPath}`;

        logger.debug(`生成文件流URL: ${fullUrl}`);
        
        return fullUrl;
    }

    /**
     * 获取带认证的文件URL
     */
    getAuthenticatedFileUrl(filePath) {
        const streamUrl = this.getFileStreamUrl(filePath);
        
        // 添加认证信息到URL（Base64编码）
        const auth = btoa(`${this.config.username}:${this.config.password}`);
        
        return {
            url: streamUrl,
            headers: {
                'Authorization': `Basic ${auth}`
            }
        };
    }

    /**
     * 检查文件是否存在
     */
    async fileExists(filePath) {
        if (!this.isConnected) {
            return false;
        }

        try {
            await this.client.stat(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取文件信息
     */
    async getFileInfo(filePath) {
        if (!this.isConnected) {
            throw new Error('未连接到WebDAV服务器');
        }

        try {
            const stat = await this.client.stat(filePath, { details: true });
            logger.debug(`获取文件信息: ${filePath}`, stat);
            return stat;
        } catch (error) {
            logger.error(`获取文件信息失败: ${filePath}`, { error: error.message });
            throw error;
        }
    }

    /**
     * 导航到指定路径
     */
    async navigateTo(path) {
        const normalizedPath = this.normalizePath(path);
        
        try {
            await this.getDirectoryContents(normalizedPath);
            this.currentPath = normalizedPath;
            
            logger.info(`导航到: ${normalizedPath}`);
            return normalizedPath;
        } catch (error) {
            logger.error(`导航失败: ${normalizedPath}`, { error: error.message });
            throw error;
        }
    }

    /**
     * 导航到上级目录
     */
    async navigateUp() {
        if (this.currentPath === this.config.basePath) {
            logger.warn('已在根目录，无法继续向上');
            return this.currentPath;
        }

        const parentPath = this.getParentPath(this.currentPath);
        return await this.navigateTo(parentPath);
    }

    /**
     * 工具方法：规范化URL
     */
    normalizeUrl(url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        return url.replace(/\/$/, '');
    }

    /**
     * 工具方法：规范化路径
     */
    normalizePath(path) {
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    }

    /**
     * 工具方法：获取文件名
     */
    getBaseName(path) {
        return path.split('/').pop() || path;
    }

    /**
     * 工具方法：获取父级路径
     */
    getParentPath(path) {
        const parts = path.split('/').filter(p => p);
        if (parts.length <= 1) {
            return this.config.basePath;
        }
        return '/' + parts.slice(0, -1).join('/');
    }

    /**
     * 工具方法：获取文件图标
     */
    getFileIcon(filename, mime) {
        const ext = filename.split('.').pop().toLowerCase();
        
        if (this.isVideoFile(filename, mime)) {
            return '🎬';
        }
        
        const iconMap = {
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
            'pdf': '📄', 'doc': '📄', 'docx': '📄',
            'txt': '📝', 'md': '📝',
            'zip': '📦', 'rar': '📦', '7z': '📦'
        };
        
        return iconMap[ext] || '📄';
    }

    /**
     * 工具方法：检查是否为视频文件
     */
    isVideoFile(filename, mime) {
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp'];
        const ext = filename.split('.').pop().toLowerCase();
        
        return videoExtensions.includes(ext) || 
               (mime && mime.startsWith('video/'));
    }

    /**
     * 工具方法：格式化文件大小
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 获取路径分级（面包屑）
     */
    getPathBreadcrumbs() {
        const parts = this.currentPath.split('/').filter(p => p);
        const breadcrumbs = [{ name: '根目录', path: this.config.basePath }];
        
        let currentPath = this.config.basePath;
        parts.forEach(part => {
            currentPath += (currentPath === '/' ? '' : '/') + part;
            breadcrumbs.push({
                name: part,
                path: currentPath
            });
        });
        
        return breadcrumbs;
    }

    /**
     * 获取连接状态
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            currentPath: this.currentPath,
            serverUrl: this.config.serverUrl,
            username: this.config.username
        };
    }
}

// 创建全局WebDAV客户端实例
window.webdavClient = new WebDAVClient();