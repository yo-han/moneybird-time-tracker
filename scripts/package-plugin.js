#!/usr/bin/env node

import { execSync } from 'child_process';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const EXCLUDED_DIRECTORIES = ['logs', 'node_modules', '.git'];
const EXCLUDED_FILES = ['.DS_Store'];
const EXCLUDED_EXTENSIONS = ['.log', '.map'];

function isExcludedFromPackage(relativePath) {
  const segments = relativePath.split(/[\\/]/);
  const fileName = segments[segments.length - 1];

  return (
    segments.some(segment => EXCLUDED_DIRECTORIES.includes(segment)) ||
    EXCLUDED_FILES.includes(fileName) ||
    EXCLUDED_EXTENSIONS.includes(path.extname(fileName))
  );
}

async function packagePlugin() {
  try {
    console.log('🚀 Starting plugin packaging process...\n');

    // Check if we should skip version bump
    const skipBump = process.argv.includes('--no-bump');
    
    if (!skipBump) {
      // Step 0: Bump version number
      console.log('📝 Bumping version number...');
      execSync('node scripts/bump-version.js', { stdio: 'inherit', cwd: projectRoot });
      console.log('');
    }

    // Step 1: Clean previous builds
    console.log('🧹 Cleaning previous builds...');
    const distPath = path.join(projectRoot, 'dist');
    const pluginPath = path.join(projectRoot, 'com.johan-kuijt.moneybird-timer.sdPlugin');
    
    try {
      await fs.rm(path.join(pluginPath, 'bin'), { recursive: true, force: true });
      await fs.rm(path.join(pluginPath, 'logs'), { recursive: true, force: true });
      await fs.rm(distPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors if directories don't exist
    }
    
    await fs.mkdir(distPath, { recursive: true });

    // Step 2: Run build
    console.log('🔨 Building TypeScript files...');
    execSync('npm run build', { stdio: 'inherit', cwd: projectRoot });
    console.log('✅ Build completed\n');

    // Step 3: Validate plugin (fail fast if invalid)
    console.log('🔍 Validating plugin...');
    execSync(`npx --no-install streamdeck validate "${pluginPath}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
    });
    console.log('✅ Plugin validation passed\n');

    // Step 4: Create .streamDeckPlugin file
    console.log('📦 Creating .streamDeckPlugin file...');
    const outputPath = path.join(distPath, 'com.johan-kuijt.moneybird-timer.streamDeckPlugin');
    
    // Remove old plugin file if exists
    try {
      await fs.unlink(outputPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    const output = createWriteStream(outputPath);
    const archive = new ZipArchive({
      zlib: { level: 9 } // Maximum compression
    });

    output.on('close', () => {
      const size = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`✅ Plugin packaged successfully!\n`);
      console.log(`📁 Output: ${outputPath}`);
      console.log(`📏 Size: ${size} MB`);
      console.log(`🔢 Total files: ${archive.pointer()} bytes\n`);
      
      console.log('🎉 Plugin is ready for distribution!');
      console.log('\nTo install the plugin:');
      console.log('1. Double-click the .streamDeckPlugin file in Finder/Explorer');
      console.log('2. Or drag and drop it onto the Stream Deck application');
      console.log('\nThe plugin file is located at:');
      console.log(outputPath);
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(output);

    // Add all files from the plugin directory. archiver only skips entries when the
    // third argument is a function that returns false; entry.name is relative to pluginPath.
    archive.directory(pluginPath, 'com.johan-kuijt.moneybird-timer.sdPlugin', entry =>
      isExcludedFromPackage(entry.name) ? false : entry
    );

    await archive.finalize();

  } catch (error) {
    console.error('❌ Error packaging plugin:', error);
    process.exit(1);
  }
}

// Run the packaging
packagePlugin();
