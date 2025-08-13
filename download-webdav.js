/**
 * 下载WebDAV库到本地的脚本
 * 运行: node download-webdav.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const WEBDAV_URLS = [
    'https://unpkg.com/webdav@5.3.0/dist/web/index.js',
    'https://cdn.jsdelivr.net/npm/webdav@5.3.0/dist/web/index.js'
];

const OUTPUT_FILE = path.join(__dirname, 'webdav.min.js');

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        console.log(`正在从 ${url} 下载...`);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                resolve(data);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

async function downloadWebDAVLibrary() {
    for (const url of WEBDAV_URLS) {
        try {
            const content = await downloadFile(url);
            
            // 验证下载的内容
            if (content.includes('webdav') && content.includes('createClient')) {
                fs.writeFileSync(OUTPUT_FILE, content);
                console.log(`✅ WebDAV库已成功下载到: ${OUTPUT_FILE}`);
                console.log(`文件大小: ${(content.length / 1024).toFixed(2)} KB`);
                return true;
            } else {
                console.warn(`⚠️  从 ${url} 下载的内容似乎不是有效的WebDAV库`);
            }
        } catch (error) {
            console.error(`❌ 从 ${url} 下载失败:`, error.message);
        }
    }
    
    return false;
}

// 主函数
async function main() {
    console.log('🚀 开始下载WebDAV库...');
    
    const success = await downloadWebDAVLibrary();
    
    if (success) {
        console.log('🎉 下载完成！');
        console.log('📝 请在HTML文件中使用以下引用:');
        console.log('   <script src="webdav.min.js"></script>');
    } else {
        console.error('💥 所有下载尝试都失败了');
        console.log('📋 备用方案:');
        console.log('1. 检查网络连接');
        console.log('2. 手动下载库文件');
        console.log('3. 使用其他WebDAV客户端库');
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { downloadWebDAVLibrary };