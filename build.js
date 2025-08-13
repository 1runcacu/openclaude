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

    // 复制 tiktoken WASM 文件
    const tiktokenWasm = path.join('node_modules', 'tiktoken', 'tiktoken_bg.wasm');
    if (fs.existsSync(tiktokenWasm)) {
      const destWasm = path.join('dist', 'tiktoken_bg.wasm');
      fs.copyFileSync(tiktokenWasm, destWasm);
      console.log('📁 已复制 tiktoken_bg.wasm');
    }

    // 复制其他 claude 文件（如果存在）
    const env = path.resolve('.env.example');
    if (fs.existsSync(env)) {
      const destEnv = path.join('dist', '.env.example');
      fs.copyFileSync(env, destEnv);
      console.log('📁 已复制 env');
    }

    // 复制其他 claude 文件（如果存在）
    const models = path.resolve('models.example.json');
    if (fs.existsSync(models)) {
      const destModels = path.join('dist', 'models.example.json');
      fs.copyFileSync(models, destModels);
      console.log('📁 已复制 models.example.json');
    }
    

    // 复制其他 claude 文件（如果存在）
    const claude = path.resolve('claude');
    if (fs.existsSync(claude)) {
      const destClaude = path.join('dist', 'claude');
      fs.copyFileSync(claude, destClaude);
      console.log('📁 已复制 claude');
    }
    
    // 复制其他 WASM 文件（如果存在）
    const yogaWasm = path.resolve('yoga.wasm');
    if (fs.existsSync(yogaWasm)) {
      const destYoga = path.join('dist', 'yoga.wasm');
      fs.copyFileSync(yogaWasm, destYoga);
      console.log('📁 已复制 yoga.wasm');
    }

    // 使文件可执行
    const outputPath = path.resolve('dist/app.js');
    if (fs.existsSync(outputPath)) {
      fs.chmodSync(outputPath, '755');
      console.log('✅ 构建成功！');
      console.log(`📦 输出文件: ${outputPath}`);
      console.log(`🚀 运行命令: node dist/app.js`);
      console.log(`🚀 或直接执行: ./dist/app.js`);
      console.log(`⚠️  部署时请确保 dist 目录下的 WASM 文件也一起复制`);
      
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