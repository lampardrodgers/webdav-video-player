/**
 * 综合日志管理系统
 * 提供多级日志记录、本地存储、导出功能
 */
class Logger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000; // 最大日志条数
        this.currentLevel = 'INFO';
        this.levels = {
            'DEBUG': 0,
            'INFO': 1,
            'WARN': 2,
            'ERROR': 3
        };
        
        // 从localStorage恢复日志
        this.loadLogsFromStorage();
        
        // 绑定UI元素
        this.initUI();
        
        // 开始日志记录
        this.info('日志系统已初始化');
    }

    /**
     * 初始化UI元素
     */
    initUI() {
        this.logsContainer = document.getElementById('logsContainer');
        this.logLevelSelect = document.getElementById('logLevel');
        this.clearLogsBtn = document.getElementById('clearLogsBtn');
        this.exportLogsBtn = document.getElementById('exportLogsBtn');

        // 绑定事件
        if (this.logLevelSelect) {
            this.logLevelSelect.addEventListener('change', (e) => {
                this.setLevel(e.target.value);
            });
        }

        if (this.clearLogsBtn) {
            this.clearLogsBtn.addEventListener('click', () => {
                this.clearLogs();
            });
        }

        if (this.exportLogsBtn) {
            this.exportLogsBtn.addEventListener('click', () => {
                this.exportLogs();
            });
        }
    }

    /**
     * 设置日志级别
     */
    setLevel(level) {
        this.currentLevel = level;
        this.refreshDisplay();
        this.debug(`日志级别已设置为: ${level}`);
    }

    /**
     * 记录DEBUG级别日志
     */
    debug(message, data = null) {
        this.log('DEBUG', message, data);
    }

    /**
     * 记录INFO级别日志
     */
    info(message, data = null) {
        this.log('INFO', message, data);
    }

    /**
     * 记录WARN级别日志
     */
    warn(message, data = null) {
        this.log('WARN', message, data);
    }

    /**
     * 记录ERROR级别日志
     */
    error(message, data = null) {
        this.log('ERROR', message, data);
    }

    /**
     * 核心日志记录方法
     */
    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data: data ? JSON.stringify(data, null, 2) : null,
            id: Date.now() + Math.random()
        };

        // 添加到日志数组
        this.logs.push(logEntry);

        // 限制日志数量
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // 保存到localStorage
        this.saveLogsToStorage();

        // 更新显示
        if (this.shouldDisplayLevel(level)) {
            this.appendLogToDisplay(logEntry);
        }

        // 控制台输出
        this.logToConsole(level, message, data);
    }

    /**
     * 判断是否应该显示该级别的日志
     */
    shouldDisplayLevel(level) {
        return this.levels[level] >= this.levels[this.currentLevel];
    }

    /**
     * 添加日志到显示容器
     */
    appendLogToDisplay(logEntry) {
        if (!this.logsContainer) return;

        const logElement = this.createLogElement(logEntry);
        this.logsContainer.appendChild(logElement);

        // 自动滚动到底部
        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;

        // 限制DOM中的日志条数
        const maxDisplayLogs = 500;
        const children = this.logsContainer.children;
        if (children.length > maxDisplayLogs) {
            for (let i = 0; i < children.length - maxDisplayLogs; i++) {
                this.logsContainer.removeChild(children[i]);
            }
        }
    }

    /**
     * 创建日志DOM元素
     */
    createLogElement(logEntry) {
        const div = document.createElement('div');
        div.className = `log-entry ${logEntry.level.toLowerCase()}`;
        
        const timestamp = new Date(logEntry.timestamp).toLocaleString('zh-CN');
        const dataText = logEntry.data ? `\n${logEntry.data}` : '';
        
        div.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            <span class="log-level">[${logEntry.level}]</span>
            <span class="log-message">${this.escapeHtml(logEntry.message)}${dataText}</span>
        `;
        
        return div;
    }

    /**
     * 转义HTML字符
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 输出到浏览器控制台
     */
    logToConsole(level, message, data) {
        const consoleMethods = {
            'DEBUG': 'log',
            'INFO': 'info',
            'WARN': 'warn',
            'ERROR': 'error'
        };

        const method = consoleMethods[level] || 'log';
        if (data) {
            console[method](`[WebDAV Player] ${message}`, data);
        } else {
            console[method](`[WebDAV Player] ${message}`);
        }
    }

    /**
     * 刷新显示
     */
    refreshDisplay() {
        if (!this.logsContainer) return;

        this.logsContainer.innerHTML = '';
        
        this.logs.forEach(logEntry => {
            if (this.shouldDisplayLevel(logEntry.level)) {
                this.appendLogToDisplay(logEntry);
            }
        });
    }

    /**
     * 清空日志
     */
    clearLogs() {
        this.logs = [];
        this.saveLogsToStorage();
        
        if (this.logsContainer) {
            this.logsContainer.innerHTML = '';
        }
        
        this.info('日志已清空');
    }

    /**
     * 导出日志
     */
    exportLogs() {
        try {
            const exportData = {
                exportTime: new Date().toISOString(),
                totalLogs: this.logs.length,
                logs: this.logs
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `webdav-player-logs-${new Date().toISOString().split('T')[0]}.json`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            URL.revokeObjectURL(url);
            
            this.info('日志已导出', { count: this.logs.length });
        } catch (error) {
            this.error('导出日志失败', { error: error.message });
        }
    }

    /**
     * 保存日志到localStorage
     */
    saveLogsToStorage() {
        try {
            const storageData = {
                logs: this.logs.slice(-500), // 只保存最近500条
                lastSaved: new Date().toISOString()
            };
            localStorage.setItem('webdav_player_logs', JSON.stringify(storageData));
        } catch (error) {
            console.error('保存日志到localStorage失败:', error);
        }
    }

    /**
     * 从localStorage加载日志
     */
    loadLogsFromStorage() {
        try {
            const stored = localStorage.getItem('webdav_player_logs');
            if (stored) {
                const data = JSON.parse(stored);
                this.logs = data.logs || [];
                this.debug(`从本地存储加载了 ${this.logs.length} 条历史日志`);
            }
        } catch (error) {
            console.error('从localStorage加载日志失败:', error);
            this.logs = [];
        }
    }

    /**
     * 记录网络请求
     */
    logRequest(method, url, status, duration, details = null) {
        const message = `${method} ${url} - ${status} (${duration}ms)`;
        if (status >= 400) {
            this.error(message, details);
        } else if (status >= 300) {
            this.warn(message, details);
        } else {
            this.debug(message, details);
        }
    }

    /**
     * 记录WebDAV操作
     */
    logWebDAVOperation(operation, path, result, details = null) {
        const message = `WebDAV ${operation}: ${path} - ${result}`;
        if (result === 'success') {
            this.info(message, details);
        } else {
            this.error(message, details);
        }
    }

    /**
     * 记录视频播放事件
     */
    logVideoEvent(event, videoSrc, details = null) {
        const message = `视频事件: ${event} - ${videoSrc}`;
        this.info(message, details);
    }

    /**
     * 记录性能信息
     */
    logPerformance(action, duration, details = null) {
        const message = `性能: ${action} 耗时 ${duration}ms`;
        if (duration > 5000) {
            this.warn(message, details);
        } else {
            this.debug(message, details);
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            debug: 0,
            info: 0,
            warn: 0,
            error: 0
        };

        this.logs.forEach(log => {
            stats[log.level.toLowerCase()]++;
        });

        return stats;
    }
}

// 创建全局日志实例
window.logger = new Logger();