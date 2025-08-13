/**
 * 主应用程序逻辑
 * 整合所有模块，处理用户交互
 */
class WebDAVVideoApp {
    constructor() {
        this.isInitialized = false;
        this.currentConnection = null;
        this.uiElements = {};
        
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initialize());
        } else {
            this.initialize();
        }
    }

    /**
     * 初始化应用
     */
    async initialize() {
        try {
            logger.info('WebDAV视频播放器应用启动');
            
            // 初始化UI元素
            this.initializeUIElements();
            
            // 绑定事件监听器
            this.bindEventListeners();
            
            // 恢复上次的连接配置
            this.restoreConnectionConfig();
            
            // 更新UI状态
            this.updateConnectionStatus('未连接');
            
            this.isInitialized = true;
            logger.info('应用初始化完成');
            
        } catch (error) {
            logger.error('应用初始化失败', { error: error.message });
            this.showError('应用初始化失败: ' + error.message);
        }
    }

    /**
     * 初始化UI元素引用
     */
    initializeUIElements() {
        this.uiElements = {
            // 连接配置
            serverUrl: document.getElementById('serverUrl'),
            username: document.getElementById('username'),
            password: document.getElementById('password'),
            basePath: document.getElementById('basePath'),
            connectBtn: document.getElementById('connectBtn'),
            disconnectBtn: document.getElementById('disconnectBtn'),
            connectionStatus: document.getElementById('connectionStatus'),
            
            // 文件浏览
            breadcrumb: document.getElementById('breadcrumb'),
            fileList: document.getElementById('fileList'),
            
            // 加载遮罩
            loadingOverlay: document.getElementById('loadingOverlay')
        };

        // 检查必要元素
        const requiredElements = ['serverUrl', 'connectBtn', 'fileList'];
        for (const elementId of requiredElements) {
            if (!this.uiElements[elementId]) {
                throw new Error(`必要的UI元素未找到: ${elementId}`);
            }
        }
    }

    /**
     * 绑定事件监听器
     */
    bindEventListeners() {
        // 连接按钮
        this.uiElements.connectBtn.addEventListener('click', () => this.handleConnect());
        
        // 断开连接按钮
        if (this.uiElements.disconnectBtn) {
            this.uiElements.disconnectBtn.addEventListener('click', () => this.handleDisconnect());
        }

        // 回车键连接
        [this.uiElements.serverUrl, this.uiElements.username, this.uiElements.password, this.uiElements.basePath].forEach(element => {
            if (element) {
                element.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.handleConnect();
                    }
                });
            }
        });

        // 面包屑导航点击
        if (this.uiElements.breadcrumb) {
            this.uiElements.breadcrumb.addEventListener('click', (e) => {
                if (e.target.classList.contains('breadcrumb-item')) {
                    const path = e.target.dataset.path;
                    if (path) {
                        this.navigateToPath(path);
                    }
                }
            });
        }

        // 文件列表点击
        this.uiElements.fileList.addEventListener('click', (e) => {
            const fileItem = e.target.closest('.file-item');
            if (fileItem) {
                this.handleFileClick(fileItem);
            }
        });

        // 监听WebDAV客户端状态变化
        window.addEventListener('webdav-status-change', (e) => {
            this.handleWebDAVStatusChange(e.detail);
        });

        // 监听视频播放器事件
        window.addEventListener('video-player-event', (e) => {
            this.handleVideoPlayerEvent(e.detail);
        });
    }

    /**
     * 处理连接按钮点击
     */
    async handleConnect() {
        if (!this.validateConnectionForm()) {
            return;
        }

        const config = this.getConnectionConfig();
        
        try {
            this.showLoading('正在连接WebDAV服务器...');
            this.updateConnectionStatus('连接中...', 'connecting');
            this.setConnectionButtonsState(false, false);
            
            logger.info('开始连接WebDAV服务器', {
                serverUrl: config.serverUrl,
                username: config.username
            });

            // 执行连接
            const success = await webdavClient.connect(
                config.serverUrl,
                config.username,
                config.password,
                config.basePath
            );

            if (success) {
                this.currentConnection = config;
                this.saveConnectionConfig();
                this.updateConnectionStatus('已连接', 'connected');
                this.setConnectionButtonsState(false, true);
                
                // 加载初始目录
                await this.loadDirectory();
                
                logger.info('WebDAV服务器连接成功');
            }
            
        } catch (error) {
            this.updateConnectionStatus('连接失败', 'disconnected');
            this.setConnectionButtonsState(true, false);
            this.showError('连接失败: ' + error.message);
            
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 处理断开连接
     */
    handleDisconnect() {
        try {
            webdavClient.disconnect();
            videoPlayer.cleanup();
            
            this.currentConnection = null;
            this.updateConnectionStatus('未连接', 'disconnected');
            this.setConnectionButtonsState(true, false);
            this.clearFileList();
            this.clearBreadcrumb();
            
            logger.info('已断开WebDAV服务器连接');
            
        } catch (error) {
            logger.error('断开连接时出错', { error: error.message });
        }
    }

    /**
     * 验证连接表单
     */
    validateConnectionForm() {
        const serverUrl = this.uiElements.serverUrl.value.trim();
        const username = this.uiElements.username.value.trim();
        
        if (!serverUrl) {
            this.showError('请输入服务器地址');
            this.uiElements.serverUrl.focus();
            return false;
        }

        if (!username) {
            this.showError('请输入用户名');
            this.uiElements.username.focus();
            return false;
        }

        return true;
    }

    /**
     * 获取连接配置
     */
    getConnectionConfig() {
        return {
            serverUrl: this.uiElements.serverUrl.value.trim(),
            username: this.uiElements.username.value.trim(),
            password: this.uiElements.password.value,
            basePath: this.uiElements.basePath.value.trim() || '/'
        };
    }

    /**
     * 加载目录内容
     */
    async loadDirectory(path = null) {
        try {
            this.showLoading('正在加载目录...');
            
            const contents = await webdavClient.getDirectoryContents(path);
            this.displayDirectoryContents(contents);
            this.updateBreadcrumb();
            
            logger.info('目录加载完成', {
                path: webdavClient.currentPath,
                fileCount: contents.files.length,
                folderCount: contents.folders.length
            });
            
        } catch (error) {
            this.showError('加载目录失败: ' + error.message);
            logger.error('加载目录失败', { error: error.message, path: path });
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 显示目录内容
     */
    displayDirectoryContents(contents) {
        const fileList = this.uiElements.fileList;
        fileList.innerHTML = '';

        if (contents.all.length === 0) {
            fileList.innerHTML = '<div class="empty-state">目录为空</div>';
            return;
        }

        // 显示所有项目（文件夹和文件）
        contents.all.forEach(item => {
            const fileItem = this.createFileItem(item);
            fileList.appendChild(fileItem);
        });
    }

    /**
     * 创建文件列表项
     */
    createFileItem(item) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.dataset.path = item.path;
        div.dataset.type = item.type;
        div.dataset.name = item.name;

        const isVideo = webdavClient.isVideoFile(item.name, item.mime);
        const itemClass = item.type === 'directory' ? 'folder' : (isVideo ? 'video-file' : '');
        
        div.innerHTML = `
            <div class="file-icon ${itemClass}">${item.icon}</div>
            <div class="file-name">${this.escapeHtml(item.name)}</div>
            <div class="file-size">${item.formattedSize || ''}</div>
        `;

        return div;
    }

    /**
     * 处理文件点击
     */
    async handleFileClick(fileItem) {
        const path = fileItem.dataset.path;
        const type = fileItem.dataset.type;
        const name = fileItem.dataset.name;

        try {
            if (type === 'directory') {
                // 导航到目录
                await this.navigateToPath(path);
            } else {
                // 检查是否为视频文件
                if (webdavClient.isVideoFile(name)) {
                    await this.playVideo({
                        name: name,
                        path: path,
                        type: type,
                        formattedSize: fileItem.querySelector('.file-size').textContent
                    });
                } else {
                    this.showInfo(`不支持播放此文件类型: ${name}`);
                }
            }
        } catch (error) {
            this.showError(`操作失败: ${error.message}`);
        }
    }

    /**
     * 导航到指定路径
     */
    async navigateToPath(path) {
        try {
            this.showLoading('正在加载...');
            await webdavClient.navigateTo(path);
            await this.loadDirectory();
        } catch (error) {
            this.showError('导航失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 播放视频
     */
    async playVideo(videoFile) {
        try {
            this.showLoading('正在加载视频...');
            
            logger.info('开始播放视频', { name: videoFile.name, path: videoFile.path });
            
            await videoPlayer.loadVideo(videoFile);
            
            // 尝试自动播放
            try {
                await videoPlayer.play();
            } catch (playError) {
                // 自动播放可能被浏览器阻止，这是正常的
                logger.warn('自动播放被阻止，需要用户手动播放', { error: playError.message });
            }
            
        } catch (error) {
            this.showError('视频加载失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 更新面包屑导航
     */
    updateBreadcrumb() {
        if (!this.uiElements.breadcrumb) return;

        const breadcrumbs = webdavClient.getPathBreadcrumbs();
        
        const breadcrumbHtml = breadcrumbs.map((crumb, index) => {
            const separator = index > 0 ? '<span class="breadcrumb-separator">/</span>' : '';
            return `${separator}<span class="breadcrumb-item" data-path="${crumb.path}">${this.escapeHtml(crumb.name)}</span>`;
        }).join('');

        this.uiElements.breadcrumb.innerHTML = breadcrumbHtml;
    }

    /**
     * 清空面包屑
     */
    clearBreadcrumb() {
        if (this.uiElements.breadcrumb) {
            this.uiElements.breadcrumb.innerHTML = '';
        }
    }

    /**
     * 清空文件列表
     */
    clearFileList() {
        if (this.uiElements.fileList) {
            this.uiElements.fileList.innerHTML = '<div class="empty-state">请先连接WebDAV服务器</div>';
        }
    }

    /**
     * 更新连接状态显示
     */
    updateConnectionStatus(text, status = 'disconnected') {
        if (this.uiElements.connectionStatus) {
            this.uiElements.connectionStatus.textContent = text;
            this.uiElements.connectionStatus.className = `connection-status ${status}`;
        }
    }

    /**
     * 设置连接按钮状态
     */
    setConnectionButtonsState(connectEnabled, disconnectEnabled) {
        if (this.uiElements.connectBtn) {
            this.uiElements.connectBtn.disabled = !connectEnabled;
        }
        if (this.uiElements.disconnectBtn) {
            this.uiElements.disconnectBtn.disabled = !disconnectEnabled;
        }
    }

    /**
     * 显示加载遮罩
     */
    showLoading(text = '加载中...') {
        if (this.uiElements.loadingOverlay) {
            const loadingText = this.uiElements.loadingOverlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = text;
            }
            this.uiElements.loadingOverlay.classList.add('show');
        }
    }

    /**
     * 隐藏加载遮罩
     */
    hideLoading() {
        if (this.uiElements.loadingOverlay) {
            this.uiElements.loadingOverlay.classList.remove('show');
        }
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        logger.error('用户界面错误', { message: message });
        alert('错误: ' + message);
    }

    /**
     * 显示信息消息
     */
    showInfo(message) {
        logger.info('用户界面信息', { message: message });
        alert('信息: ' + message);
    }

    /**
     * 保存连接配置到localStorage
     */
    saveConnectionConfig() {
        if (!this.currentConnection) return;

        try {
            const configToSave = {
                serverUrl: this.currentConnection.serverUrl,
                username: this.currentConnection.username,
                basePath: this.currentConnection.basePath
                // 注意：出于安全考虑，不保存密码
            };
            
            localStorage.setItem('webdav_config', JSON.stringify(configToSave));
            logger.debug('连接配置已保存');
        } catch (error) {
            logger.error('保存连接配置失败', { error: error.message });
        }
    }

    /**
     * 恢复连接配置
     */
    restoreConnectionConfig() {
        try {
            const saved = localStorage.getItem('webdav_config');
            if (saved) {
                const config = JSON.parse(saved);
                
                if (this.uiElements.serverUrl) this.uiElements.serverUrl.value = config.serverUrl || '';
                if (this.uiElements.username) this.uiElements.username.value = config.username || '';
                if (this.uiElements.basePath) this.uiElements.basePath.value = config.basePath || '/';
                
                logger.debug('连接配置已恢复');
            }
        } catch (error) {
            logger.error('恢复连接配置失败', { error: error.message });
        }
    }

    /**
     * 转义HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 处理WebDAV状态变化
     */
    handleWebDAVStatusChange(detail) {
        logger.debug('WebDAV状态变化', detail);
        // 可以在这里处理状态变化的UI更新
    }

    /**
     * 处理视频播放器事件
     */
    handleVideoPlayerEvent(detail) {
        logger.debug('视频播放器事件', detail);
        // 可以在这里处理播放器事件的UI更新
    }

    /**
     * 获取应用状态
     */
    getAppStatus() {
        return {
            isInitialized: this.isInitialized,
            isConnected: webdavClient.isConnected,
            currentPath: webdavClient.currentPath,
            currentVideo: videoPlayer.currentVideoInfo,
            playbackState: videoPlayer.getPlaybackState()
        };
    }
}

// 创建全局应用实例
window.webdavApp = new WebDAVVideoApp();

// 导出一些有用的全局函数供调试使用
window.debugApp = {
    getStatus: () => window.webdavApp.getAppStatus(),
    getLogs: () => logger.logs,
    getLogStats: () => logger.getStats(),
    clearLogs: () => logger.clearLogs(),
    testConnection: () => webdavClient.testConnection(),
    getVideoState: () => videoPlayer.getPlaybackState()
};