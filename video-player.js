/**
 * 视频播放器管理类
 * 处理视频播放、控制、事件监听等
 */
class VideoPlayer {
    constructor() {
        this.videoElement = null;
        this.currentVideoInfo = null;
        this.playbackState = {
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            volume: 1,
            muted: false,
            fullscreen: false
        };
        this.supportedFormats = this.detectSupportedFormats();
        
        this.initializePlayer();
        logger.debug('视频播放器已初始化', { supportedFormats: this.supportedFormats });
    }

    /**
     * 初始化播放器
     */
    initializePlayer() {
        this.videoElement = document.getElementById('videoPlayer');
        this.videoInfoElement = document.getElementById('videoInfo');

        if (!this.videoElement) {
            logger.error('未找到视频播放器元素');
            return;
        }

        this.setupEventListeners();
        this.updateVideoInfo('等待选择视频文件...');
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 播放事件
        this.videoElement.addEventListener('play', () => {
            this.playbackState.isPlaying = true;
            logger.logVideoEvent('播放开始', this.currentVideoInfo?.name || 'unknown');
        });

        this.videoElement.addEventListener('pause', () => {
            this.playbackState.isPlaying = false;
            logger.logVideoEvent('播放暂停', this.currentVideoInfo?.name || 'unknown');
        });

        this.videoElement.addEventListener('ended', () => {
            this.playbackState.isPlaying = false;
            logger.logVideoEvent('播放结束', this.currentVideoInfo?.name || 'unknown');
        });

        // 时间更新
        this.videoElement.addEventListener('timeupdate', () => {
            this.playbackState.currentTime = this.videoElement.currentTime;
            this.playbackState.duration = this.videoElement.duration || 0;
        });

        // 音量变化
        this.videoElement.addEventListener('volumechange', () => {
            this.playbackState.volume = this.videoElement.volume;
            this.playbackState.muted = this.videoElement.muted;
            logger.debug('音量变化', {
                volume: this.playbackState.volume,
                muted: this.playbackState.muted
            });
        });

        // 加载事件
        this.videoElement.addEventListener('loadstart', () => {
            logger.logVideoEvent('开始加载', this.currentVideoInfo?.name || 'unknown');
            this.updateVideoInfo('正在加载视频...');
        });

        this.videoElement.addEventListener('loadedmetadata', () => {
            const duration = this.videoElement.duration;
            const videoWidth = this.videoElement.videoWidth;
            const videoHeight = this.videoElement.videoHeight;
            
            logger.logVideoEvent('元数据已加载', this.currentVideoInfo?.name || 'unknown', {
                duration: duration,
                resolution: `${videoWidth}x${videoHeight}`
            });

            this.updateVideoInfo();
        });

        this.videoElement.addEventListener('canplay', () => {
            logger.logVideoEvent('可以播放', this.currentVideoInfo?.name || 'unknown');
        });

        this.videoElement.addEventListener('canplaythrough', () => {
            logger.logVideoEvent('可以流畅播放', this.currentVideoInfo?.name || 'unknown');
        });

        // 缓冲事件
        this.videoElement.addEventListener('waiting', () => {
            logger.logVideoEvent('缓冲中', this.currentVideoInfo?.name || 'unknown');
        });

        this.videoElement.addEventListener('playing', () => {
            logger.logVideoEvent('开始播放', this.currentVideoInfo?.name || 'unknown');
        });

        // 错误处理
        this.videoElement.addEventListener('error', (e) => {
            const error = this.videoElement.error;
            logger.error('视频播放错误', {
                code: error?.code,
                message: error?.message,
                video: this.currentVideoInfo?.name
            });
            this.handlePlaybackError(error);
        });

        // 进度事件
        this.videoElement.addEventListener('progress', () => {
            const buffered = this.videoElement.buffered;
            if (buffered.length > 0) {
                const bufferedEnd = buffered.end(buffered.length - 1);
                const duration = this.videoElement.duration;
                const bufferedPercent = duration ? (bufferedEnd / duration) * 100 : 0;
                
                logger.debug('缓冲进度', {
                    bufferedPercent: bufferedPercent.toFixed(2) + '%',
                    bufferedTime: bufferedEnd.toFixed(2) + 's'
                });
            }
        });

        // 全屏事件
        document.addEventListener('fullscreenchange', () => {
            this.playbackState.fullscreen = !!document.fullscreenElement;
            logger.debug('全屏状态变化', { fullscreen: this.playbackState.fullscreen });
        });
    }

    /**
     * 加载并播放视频
     */
    async loadVideo(videoFile) {
        const startTime = Date.now();
        
        try {
            logger.info('开始加载视频', {
                name: videoFile.name,
                path: videoFile.path,
                size: videoFile.formattedSize
            });

            // 检查格式支持
            if (!this.isFormatSupported(videoFile.name)) {
                throw new Error(`不支持的视频格式: ${this.getFileExtension(videoFile.name)}`);
            }

            // 保存当前视频信息
            this.currentVideoInfo = videoFile;

            // 获取视频URL
            const videoUrl = webdavClient.getFileStreamUrl(videoFile.path);
            
            // 设置视频源
            this.videoElement.src = videoUrl;
            
            // 预加载
            this.videoElement.load();

            const duration = Date.now() - startTime;
            logger.logPerformance('视频加载', duration);
            
            return true;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.logPerformance('视频加载失败', duration);
            logger.error('视频加载失败', {
                error: error.message,
                video: videoFile.name
            });
            
            this.handleLoadError(error);
            throw error;
        }
    }

    /**
     * 播放视频
     */
    async play() {
        try {
            await this.videoElement.play();
            logger.debug('视频播放成功');
        } catch (error) {
            logger.error('视频播放失败', { error: error.message });
            throw error;
        }
    }

    /**
     * 暂停视频
     */
    pause() {
        this.videoElement.pause();
        logger.debug('视频已暂停');
    }

    /**
     * 停止视频
     */
    stop() {
        this.videoElement.pause();
        this.videoElement.currentTime = 0;
        logger.debug('视频已停止');
    }

    /**
     * 设置音量
     */
    setVolume(volume) {
        if (volume >= 0 && volume <= 1) {
            this.videoElement.volume = volume;
            logger.debug('音量已设置', { volume: volume });
        }
    }

    /**
     * 切换静音
     */
    toggleMute() {
        this.videoElement.muted = !this.videoElement.muted;
        logger.debug('静音状态切换', { muted: this.videoElement.muted });
    }

    /**
     * 跳转到指定时间
     */
    seekTo(time) {
        if (time >= 0 && time <= this.videoElement.duration) {
            this.videoElement.currentTime = time;
            logger.debug('跳转到时间点', { time: time });
        }
    }

    /**
     * 切换全屏
     */
    async toggleFullscreen() {
        try {
            if (!document.fullscreenElement) {
                await this.videoElement.requestFullscreen();
                logger.debug('进入全屏模式');
            } else {
                await document.exitFullscreen();
                logger.debug('退出全屏模式');
            }
        } catch (error) {
            logger.error('全屏切换失败', { error: error.message });
        }
    }

    /**
     * 设置播放速度
     */
    setPlaybackRate(rate) {
        if (rate > 0 && rate <= 4) {
            this.videoElement.playbackRate = rate;
            logger.debug('播放速度已设置', { rate: rate });
        }
    }

    /**
     * 检测支持的视频格式
     */
    detectSupportedFormats() {
        const video = document.createElement('video');
        const formats = {
            mp4: video.canPlayType('video/mp4'),
            webm: video.canPlayType('video/webm'),
            ogg: video.canPlayType('video/ogg'),
            avi: '', // AVI通常不被HTML5直接支持
            mov: video.canPlayType('video/quicktime'),
            mkv: '', // MKV通常不被HTML5直接支持
            m4v: video.canPlayType('video/mp4')
        };

        const supported = Object.keys(formats).filter(format => 
            formats[format] === 'probably' || formats[format] === 'maybe'
        );

        logger.info('检测到支持的视频格式', { supported: supported });
        return supported;
    }

    /**
     * 检查格式是否支持
     */
    isFormatSupported(filename) {
        const ext = this.getFileExtension(filename);
        return this.supportedFormats.includes(ext);
    }

    /**
     * 获取文件扩展名
     */
    getFileExtension(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    /**
     * 处理播放错误
     */
    handlePlaybackError(error) {
        let errorMessage = '视频播放出现错误';
        
        if (error) {
            switch (error.code) {
                case MediaError.MEDIA_ERR_ABORTED:
                    errorMessage = '视频播放被中止';
                    break;
                case MediaError.MEDIA_ERR_NETWORK:
                    errorMessage = '网络错误导致视频下载失败';
                    break;
                case MediaError.MEDIA_ERR_DECODE:
                    errorMessage = '视频解码错误';
                    break;
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = '不支持的视频格式或网络协议';
                    break;
                default:
                    errorMessage = `未知错误 (代码: ${error.code})`;
            }
        }

        this.updateVideoInfo(`❌ ${errorMessage}`);
        logger.error('播放错误详情', { 
            errorCode: error?.code,
            errorMessage: errorMessage,
            videoSrc: this.videoElement.src
        });
    }

    /**
     * 处理加载错误
     */
    handleLoadError(error) {
        this.updateVideoInfo(`❌ 加载失败: ${error.message}`);
    }

    /**
     * 更新视频信息显示
     */
    updateVideoInfo(customMessage = null) {
        if (!this.videoInfoElement) return;

        if (customMessage) {
            this.videoInfoElement.innerHTML = customMessage;
            return;
        }

        if (!this.currentVideoInfo) {
            this.videoInfoElement.innerHTML = '未选择视频文件';
            return;
        }

        const video = this.videoElement;
        const info = this.currentVideoInfo;
        
        let infoHtml = `
            <div><strong>文件名:</strong> ${info.name}</div>
            <div><strong>文件大小:</strong> ${info.formattedSize || '未知'}</div>
        `;

        if (video.duration) {
            infoHtml += `<div><strong>时长:</strong> ${this.formatTime(video.duration)}</div>`;
        }

        if (video.videoWidth && video.videoHeight) {
            infoHtml += `<div><strong>分辨率:</strong> ${video.videoWidth}x${video.videoHeight}</div>`;
        }

        if (this.playbackState.isPlaying) {
            infoHtml += `<div><strong>状态:</strong> 播放中</div>`;
        } else {
            infoHtml += `<div><strong>状态:</strong> 已暂停</div>`;
        }

        this.videoInfoElement.innerHTML = infoHtml;
    }

    /**
     * 格式化时间显示
     */
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    /**
     * 获取播放状态
     */
    getPlaybackState() {
        return {
            ...this.playbackState,
            currentVideoInfo: this.currentVideoInfo
        };
    }

    /**
     * 获取当前播放进度
     */
    getProgress() {
        const current = this.videoElement.currentTime || 0;
        const duration = this.videoElement.duration || 0;
        return duration > 0 ? (current / duration) * 100 : 0;
    }

    /**
     * 获取缓冲进度
     */
    getBufferedProgress() {
        const buffered = this.videoElement.buffered;
        const duration = this.videoElement.duration || 0;
        
        if (buffered.length > 0 && duration > 0) {
            const bufferedEnd = buffered.end(buffered.length - 1);
            return (bufferedEnd / duration) * 100;
        }
        
        return 0;
    }

    /**
     * 重试播放
     */
    async retry() {
        if (!this.currentVideoInfo) {
            throw new Error('没有可重试的视频');
        }

        logger.info('重试播放视频', { video: this.currentVideoInfo.name });
        return await this.loadVideo(this.currentVideoInfo);
    }

    /**
     * 清理播放器
     */
    cleanup() {
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            this.videoElement.load();
        }
        
        this.currentVideoInfo = null;
        this.playbackState.isPlaying = false;
        this.updateVideoInfo('播放器已清理');
        
        logger.debug('视频播放器已清理');
    }
}

// 创建全局视频播放器实例
window.videoPlayer = new VideoPlayer();