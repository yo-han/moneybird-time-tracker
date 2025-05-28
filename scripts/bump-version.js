#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function incrementBuildNumber() {
  try {
    // Read manifest.json
    const manifestPath = path.join(projectRoot, 'com.johan-kuijt.moneybird-timer.sdPlugin', 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    // Parse current version (e.g., "0.3.0.0")
    const versionParts = manifest.Version.split('.');
    if (versionParts.length !== 4) {
      console.error('Version format should be MAJOR.MINOR.PATCH.BUILD');
      process.exit(1);
    }
    
    // Increment build number
    const buildNumber = parseInt(versionParts[3]) + 1;
    versionParts[3] = buildNumber.toString();
    const newVersion = versionParts.join('.');
    
    // Update manifest
    manifest.Version = newVersion;
    
    // Write back with proper formatting
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
    
    console.log(`✅ Version bumped to ${newVersion}`);
    
    // Also update package.json to keep versions in sync (without build number)
    const packagePath = path.join(projectRoot, 'package.json');
    const packageContent = await fs.readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    // Package.json uses semantic versioning without build number
    const packageVersion = versionParts.slice(0, 3).join('.');
    packageJson.version = packageVersion;
    
    await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`✅ Package.json version updated to ${packageVersion}`);
    
  } catch (error) {
    console.error('❌ Error incrementing build number:', error);
    process.exit(1);
  }
}

// Run the increment
incrementBuildNumber();