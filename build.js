const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function build() {
  try {
    // 清理之前的构建产物
    const distPath = path.resolve('dist');
    if (fs.existsSync(distPath)) {
      console.log('🧹 清理之前的构建产物...');
      fs.rmSync(distPath, { recursive: true, force: true });
    }
    
    // 创建 dist 目录
    fs.mkdirSync(distPath, { recursive: true });
    // 构建单个可执行文件
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      outfile: 'dist/app.js',
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      minify: true,
      sourcemap: false,
      external: [],
      // 将所有依赖打包进去
      packages: 'bundle',
      // 添加 banner 使文件可执行
      banner: {
        js: '#!/usr/bin/env node'
      },
      // 处理 JSON 模块
      loader: {
        '.json': 'json'
      },
      // 定义环境变量
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      // 解析配置
      resolveExtensions: ['.ts', '.js', '.json'],
      mainFields: ['main', 'module'],
      conditions: ['node'],
      // 处理 ES modules
      allowOverwrite: true,
    });

    // 使文件可执行
    const outputPath = path.resolve('dist/app.js');
    if (fs.existsSync(outputPath)) {
      fs.chmodSync(outputPath, '755');
      console.log('✅ 构建成功！');
      console.log(`📦 输出文件: ${outputPath}`);
      console.log(`🚀 运行命令: node dist/app.js`);
      console.log(`🚀 或直接执行: ./dist/app.js`);
      
      // 显示文件大小
      const stats = fs.statSync(outputPath);
      console.log(`📊 文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (error) {
    console.error('❌ 构建失败:', error);
    process.exit(1);
  }
}

build();