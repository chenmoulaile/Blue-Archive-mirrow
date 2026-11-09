#!/usr/bin/env node
/**
 * BA 抽卡动画素材下载脚本（Node.js 版 - 绕过 SSL 问题）
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// 输出目录
const OUTPUT_DIR = join(process.cwd(), 'resources', 'gacha');
if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 素材清单
const ASSETS = [
    // --- 背景图片 (~1.5MB) ---
    {
        filename: 'bg_street_abydos.jpg',
        url: 'https://static.kivo.wiki/gallery/bg_gacha_01.jpg',
        desc: '阿拜多斯街道背景',
    },
    {
        filename: 'bg_street_caeasr.jpg',
        url: 'https://static.kivo.wiki/gallery/bg_gacha_02.jpg',
        desc: '凯撒学院街道背景',
    },
    
    // --- 特效资源 (~0.5MB) ---
    {
        filename: 'gacha_card_back.png',
        url: 'https://raw.githubusercontent.com/ZM-Kimu/Blue-Archive-Asset-Downloader/main/assets/ui/extra/UI_Gacha_Card_Back.png',
        desc: '卡片背面图案',
    },
    {
        filename: 'fx_star_field.png',
        url: 'https://raw.githubusercontent.com/ZM-Kimu/Blue-Archive-Asset-Downloader/main/assets/ui/extra/FX_TEX_ST_Field.png',
        desc: '星空粒子 sprite sheet',
    },
    
    // --- 音效 (~0.2MB) ---
    {
        filename: 'se_gacha_confirm.ogg',
        url: 'https://bgm.blue-archive.io/se/gacha/confirm.ogg',
        desc: '确认音效',
    },
    {
        filename: 'se_gacha_flip_ssr.ogg',
        url: 'https://bgm.blue-archive.io/se/gacha/flip_ssr.ogg',
        desc: 'SSR 翻卡牌音效',
    },
    {
        filename: 'se_gacha_flip_sr.ogg',
        url: 'https://bgm.blue-archive.io/se/gacha/flip_sr.ogg',
        desc: 'SR 翻卡牌音效',
    },
    {
        filename: 'se_gacha_flip_r.ogg',
        url: 'https://bgm.blue-archive.io/se/gacha/flip_r.ogg',
        desc: 'R 翻卡牌音效',
    },
];

async function downloadFile(asset) {
    const filepath = join(OUTPUT_DIR, asset.filename);
    
    if (existsSync(filepath)) {
        console.log('[SKIP] ' + asset.filename + ' (已存在)');
        return true;
    }
    
    console.log('\nDownloading:', asset.desc);
    console.log('URL:', asset.url);
    console.log('Save:', filepath);
    
    try {
        // 使用 fetch API (Node 18+)
        const response = await fetch(asset.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            // 忽略 SSL 验证
            agent: function(url) {
                // 对于 HTTPS，禁用 SSL 验证
                const http = require('http');
                const https = require('https');
                return url.protocol === 'https:' 
                    ? new https.Agent({ rejectUnauthorized: false })
                    : new http.Agent();
            }
        });
        
        if (!response.ok) {
            throw new Error('HTTP error ' + response.status);
        }
        
        // 读取 Buffer
        const buffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        
        // 写入文件
        writeFileSync(filepath, uint8Array);
        
        const size = uint8Array.length;
        console.log('[OK] ' + asset.filename + ' (' + size.toLocaleString() + ' bytes)');
        return true;
        
    } catch (error) {
        console.log('[ERROR] ' + asset.filename + ': ' + error.message);
        return false;
    }
}

async function main() {
    console.log('=' .repeat(60));
    console.log('BA Gacha Animation Asset Downloader');
    console.log('=' .repeat(60));
    console.log('\nOutput Dir:', OUTPUT_DIR);
    console.log('Assets to download:', ASSETS.length);
    console.log('-'.repeat(60));
    
    const results = [];
    for (const asset of ASSETS) {
        const success = await downloadFile(asset);
        results.push([asset.filename, success]);
    }
    
    console.log('\n' + '-'.repeat(60));
    const successCount = results.filter(r => r[1]).length;
    const totalCount = results.length;
    
    console.log('\nDownload complete:', successCount + '/' + totalCount + ' success');
    
    if (successCount < totalCount) {
        const failed = results.filter(r => !r[1]).map(r => r[0]);
        console.log('\nFailed files:');
        failed.forEach(fn => console.log('  - ' + fn));
        console.log('\nSuggestion: Check network or use manual download');
        process.exit(1);
    } else {
        let totalSize = 0;
        const fs = require('fs');
        const files = fs.readdirSync(OUTPUT_DIR);
        files.forEach(f => {
            const stat = fs.statSync(join(OUTPUT_DIR, f));
            totalSize += stat.size;
        });
        console.log('\n[SUCCESS] All assets ready! Total size:', totalSize.toLocaleString() + ' bytes');
        console.log('\nNext step: Create React components to use these assets');
        process.exit(0);
    }
}

main();
