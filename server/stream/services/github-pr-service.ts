/**
 * GitHubPRService
 *
 * Handles Git operations and GitHub API interactions for PR generation:
 * - Clone target repository (fork)
 * - Create branch
 * - Commit changes
 * - Push to remote
 * - Create draft PR via GitHub API
 *

 * @created 2025-11-06
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { Octokit } from '@octokit/rest';
import { getConfig } from '../../config/loader';
import { getErrorMessage } from '../../utils/logger.js';

const execAsync = promisify(exec);

interface GitHubConfig {
  token: string;
  targetRepo: string; // e.g., "username/fork-repo"
  sourceRepo: string; // e.g., "org-name/documentation-repo"
  baseBranch: string; // e.g., "main"
}

interface PRCreateOptions {
  title: string;
  body: string;
  branchName: string;
  draft?: boolean;
}

interface PRResponse {
  url: string;
  number: number;
  branchName: string;
}

export class GitHubPRService {
  private config: GitHubConfig;
  private octokit: Octokit;
  private workDir: string;

  constructor(config: GitHubConfig, workDir: string = '/tmp/pr-workspaces') {
    this.config = config;
    this.workDir = workDir;
    this.octokit = new Octokit({ auth: config.token });
  }

  /**
   * Clone the target repository (fork) to a temporary directory
   * Returns the path to the cloned repository
   */
  async cloneRepository(batchId: string): Promise<string> {
    const repoPath = path.join(this.workDir, `batch-${batchId}`);

    // Remove existing directory if it exists
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, ignore
    }

    // Ensure work directory exists
    await fs.mkdir(this.workDir, { recursive: true });

    // Clone the target repository (fork)
    const repoUrl = `https://github.com/${this.config.targetRepo}.git`;

    try {
      await execAsync(`git clone ${repoUrl} ${repoPath}`, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      // Checkout the base branch
      await execAsync(`git checkout ${this.config.baseBranch}`, { cwd: repoPath });

      // Configure git user (required for commits)
      const config = getConfig();
      const botName = `${config.project.name} Bot`;
      const botEmail = `bot@${config.project.domain || config.project.shortName.toLowerCase()}.com`;
      await execAsync(`git config user.name "${botName}"`, { cwd: repoPath });
      await execAsync(`git config user.email "${botEmail}"`, { cwd: repoPath });

      return repoPath;
    } catch (error) {
      throw new Error(`Failed to clone repository: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Create a new branch for the changeset
   */
  async createBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      await execAsync(`git checkout -b ${branchName}`, { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to create branch: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Commit all changes in the repository
   */
  async commitChanges(repoPath: string, message: string): Promise<void> {
    try {
      // Stage all changes
      await execAsync('git add .', { cwd: repoPath });

      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: repoPath });

      if (!status.trim()) {
        console.log('No changes to commit');
        return;
      }

      // Commit changes
      await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to commit changes: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Push branch to remote repository
   */
  async pushBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      // Set up authentication using token
      const remoteUrl = `https://${this.config.token}@github.com/${this.config.targetRepo}.git`;
      await execAsync(`git remote set-url origin ${remoteUrl}`, { cwd: repoPath });

      // Push branch
      await execAsync(`git push -u origin ${branchName}`, { cwd: repoPath });
    } catch (error) {
      throw new Error(`Failed to push branch: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Create a pull request on GitHub
   */
  async createPullRequest(options: PRCreateOptions): Promise<PRResponse> {
    try {
      const [owner, repo] = this.config.targetRepo.split('/');

      const { data: pr } = await this.octokit.pulls.create({
        owner,
        repo,
        title: options.title,
        body: options.body,
        head: options.branchName,
        base: this.config.baseBranch,
        draft: options.draft ?? true,
      });

      return {
        url: pr.html_url,
        number: pr.number,
        branchName: options.branchName,
      };
    } catch (error) {
      throw new Error(`Failed to create pull request: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Complete workflow: clone, modify, commit, push, create PR
   * This is a high-level method that orchestrates the entire process
   */
  async createPRFromChanges(
    batchId: string,
    branchName: string,
    commitMessage: string,
    prOptions: PRCreateOptions
  ): Promise<{ repoPath: string; pr: PRResponse }> {
    // Clone repository
    const repoPath = await this.cloneRepository(batchId);

    // Create branch
    await this.createBranch(repoPath, branchName);

    // Changes should be applied by FileModificationService before this point
    // This method assumes changes are already written to disk

    // Commit changes
    await this.commitChanges(repoPath, commitMessage);

    // Push branch
    await this.pushBranch(repoPath, branchName);

    // Create PR
    const pr = await this.createPullRequest(prOptions);

    return { repoPath, pr };
  }

  /**
   * Cleanup: remove temporary repository directory
   */
  async cleanup(repoPath: string): Promise<void> {
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup repository at ${repoPath}:`, error);
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): GitHubConfig {
    return { ...this.config };
  }
}
