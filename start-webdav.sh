#!/bin/bash

# WebDAV视频播放器启动脚本
# 使用方法: ./start-webdav.sh

echo "🚀 启动WebDAV视频播放器..."
echo ""

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到Node.js"
    echo "请先安装Node.js: https://nodejs.org/"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📍 当前目录: $SCRIPT_DIR"
echo ""

# 检查代理服务器文件是否存在
if [ ! -f "proxy-server.js" ]; then
    echo "❌ 错误: 未找到proxy-server.js文件"
    exit 1
fi

echo "🔧 启动代理服务器..."
echo ""
echo "📋 配置信息:"
echo "   服务器地址: http://localhost:8090"
echo "   用户名: 18867123055"
echo "   基础路径: /小鲸鱼"
echo ""
echo "🌐 请在浏览器中打开: file://$SCRIPT_DIR/index.html"
echo ""
echo "⚠️  停止服务器: 按 Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 启动代理服务器
node proxy-server.js