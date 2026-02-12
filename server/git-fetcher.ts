/**
 * Git Documentation Fetcher Service
 * Handles cloning, pulling, and tracking changes in Git documentation repositories
 * Multi-instance aware - each instance has its own repository and cache

 * Date: 2025-10-29
 * Updated: 2025-11-14 - Multi-instance support
 * Reference: /docs/specs/rag-documentation-retrieval.md
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { InstanceConfigLoader } from './config/instance-loader';

export interface UpdateInfo {
  hasUpdates: boolean;
  currentHash: string;
  storedHash: string | null;
  changedFiles: string[];
}

export interface DocFile {
  path: string;
  content: string;
  lastModified: Date;
  commitHash: string;
  changeType: 'added' | 'modified' | 'deleted';
}

export class GitFetcher {
  private git: SimpleGit;
  private gitUrl: string;
  private branch: string;
  private cacheDir: string;
  private repoPath: string;
  private instanceId: string;
  private db: PrismaClient;

  constructor(instanceId: string, db: PrismaClient) {
    this.instanceId = instanceId;
    this.db = db;

    // Load instance-specific configuration
    const config = InstanceConfigLoader.get(instanceId);
    this.gitUrl = config.documentation.gitUrl;
    this.branch = config.documentation.branch;

    // Each instance gets its own cache directory
    this.cacheDir = `/var/cache/${config.project.shortName}-docs`;
    this.repoPath = path.join(this.cacheDir, 'repo');
    this.git = simpleGit({ binary: 'git' });

    console.log(`GitFetcher initialized for ${instanceId}: ${this.gitUrl}#${this.branch}`);
  }

  /**
   * Configure the Git fetcher with custom URL and branch
   */
  configure(url: string, branch: string = 'main'): void {
    this.gitUrl = url;
    this.branch = branch;
    console.log(`GitFetcher configured: ${url}#${branch}`);
  }

  /**
   * Ensure the cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log(`Created cache directory: ${this.cacheDir}`);
    }
  }

  /**
   * Clone or pull the repository
   */
  private async syncRepository(): Promise<void> {
    await this.ensureCacheDir();

    if (existsSync(this.repoPath)) {
      // Repository exists, pull latest changes
      console.log('Pulling latest changes from repository...');
      this.git = simpleGit({ baseDir: this.repoPath, binary: 'git' });

      try {
        await this.git.fetch();
        await this.git.checkout(this.branch);
        await this.git.pull('origin', this.branch);
      } catch (error) {
        console.error('Error pulling repository, attempting fresh clone:', error);
        // If pull fails, remove and re-clone
        await fs.rm(this.repoPath, { recursive: true, force: true });
        await this.cloneRepository();
      }
    } else {
      // Repository doesn't exist, clone it
      await this.cloneRepository();
    }
  }

  /**
   * Clone the repository
   */
  private async cloneRepository(): Promise<void> {
    console.log(`Cloning repository from ${this.gitUrl}...`);
    await this.git.clone(this.gitUrl, this.repoPath, ['--branch', this.branch]);
    this.git = simpleGit(this.repoPath);
    console.log('Repository cloned successfully');
  }

  /**
   * Get the current commit hash from the repository
   */
  async getCurrentCommitHash(): Promise<string> {
    await this.syncRepository();
    const log = await this.git.log(['-1']);
    return log.latest?.hash || '';
  }

  /**
   * Get the stored commit hash from the database
   */
  async getStoredCommitHash(): Promise<string | null> {
    const syncState = await this.db.gitSyncState.findUnique({
      where: { gitUrl: this.gitUrl },
    });
    return syncState?.lastCommitHash || null;
  }

  /**
   * Update the stored commit hash in the database
   */
  async updateCommitHash(hash: string): Promise<void> {
    await this.db.gitSyncState.upsert({
      where: { gitUrl: this.gitUrl },
      update: {
        lastCommitHash: hash,
        lastSyncAt: new Date(),
        syncStatus: 'success',
      },
      create: {
        gitUrl: this.gitUrl,
        branch: this.branch,
        lastCommitHash: hash,
        lastSyncAt: new Date(),
        syncStatus: 'success',
      },
    });
    console.log(`[${this.instanceId}] Updated commit hash to: ${hash}`);
  }

  /**
   * Check for updates in the repository
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    await this.syncRepository();

    const currentHash = await this.getCurrentCommitHash();
    const storedHash = await this.getStoredCommitHash();

    let changedFiles: string[] = [];

    if (storedHash && storedHash !== currentHash) {
      // Get list of changed files
      const diff = await this.git.diff([storedHash, currentHash, '--name-only']);
      changedFiles = diff
        .split('\n')
        .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
        .filter((file) => file.length > 0);
    } else if (!storedHash) {
      // First sync, get all markdown files
      const files = await this.git.raw(['ls-files', '*.md', '*.mdx']);
      changedFiles = files.split('\n').filter((file) => file.length > 0);
    }

    return {
      hasUpdates: storedHash !== currentHash,
      currentHash,
      storedHash,
      changedFiles,
    };
  }

  /**
   * Fetch changed files between two commit hashes
   */
  async fetchChangedFiles(fromHash: string, toHash: string): Promise<DocFile[]> {
    await this.syncRepository();

    const changedFiles: DocFile[] = [];

    if (fromHash === 'HEAD~1' || !fromHash) {
      // First sync or single commit back
      const files = await this.git.raw(['ls-files', '*.md', '*.mdx']);
      const fileList = files.split('\n').filter((file) => file.length > 0);

      for (const filePath of fileList) {
        const fullPath = path.join(this.repoPath, filePath);
        if (existsSync(fullPath)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);

          changedFiles.push({
            path: filePath,
            content,
            lastModified: stat.mtime,
            commitHash: toHash,
            changeType: 'added',
          });
        }
      }
    } else {
      // Get diff with name and status
      const diff = await this.git.raw(['diff', '--name-status', fromHash, toHash]);
      const lines = diff.split('\n').filter((line) => line.length > 0);

      for (const line of lines) {
        const [status, ...pathParts] = line.split(/\s+/);
        const filePath = pathParts.join(' ');

        // Only process markdown files
        if (!filePath.endsWith('.md') && !filePath.endsWith('.mdx')) {
          continue;
        }

        let changeType: 'added' | 'modified' | 'deleted';

        switch (status) {
          case 'A':
            changeType = 'added';
            break;
          case 'M':
            changeType = 'modified';
            break;
          case 'D':
            changeType = 'deleted';
            break;
          default:
            continue; // Skip other statuses (like rename, copy, etc.)
        }

        if (changeType === 'deleted') {
          changedFiles.push({
            path: filePath,
            content: '',
            lastModified: new Date(),
            commitHash: toHash,
            changeType,
          });
        } else {
          const fullPath = path.join(this.repoPath, filePath);
          if (existsSync(fullPath)) {
            const content = await fs.readFile(fullPath, 'utf-8');
            const stat = await fs.stat(fullPath);

            changedFiles.push({
              path: filePath,
              content,
              lastModified: stat.mtime,
              commitHash: toHash,
              changeType,
            });
          }
        }
      }
    }

    console.log(`Fetched ${changedFiles.length} changed files`);
    return changedFiles;
  }

  /**
   * Update sync status in database
   */
  async updateSyncStatus(
    status: 'idle' | 'syncing' | 'success' | 'error',
    errorMessage?: string
  ): Promise<void> {
    await this.db.gitSyncState.upsert({
      where: { gitUrl: this.gitUrl },
      update: {
        syncStatus: status,
        errorMessage: errorMessage || null,
        lastSyncAt: new Date(),
      },
      create: {
        gitUrl: this.gitUrl,
        branch: this.branch,
        syncStatus: status,
        errorMessage: errorMessage || null,
        lastSyncAt: new Date(),
      },
    });
    console.log(`[${this.instanceId}] Sync status updated to: ${status}`);
  }
}
