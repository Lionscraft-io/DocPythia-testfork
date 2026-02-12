/**
 * GitHubPRService Unit Tests
 * Tests for Git operations and GitHub API interactions

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for mocks that need to be available before imports
const { mockExecAsync, mockFsRm, mockFsMkdir, mockOctokitPullsCreate, MockOctokit, mockGetConfig } =
  vi.hoisted(() => {
    const mockExecAsync = vi.fn();
    const mockFsRm = vi.fn();
    const mockFsMkdir = vi.fn();
    const mockOctokitPullsCreate = vi.fn();

    class MockOctokit {
      pulls = {
        create: mockOctokitPullsCreate,
      };
      constructor(_opts: any) {}
    }

    const mockGetConfig = vi.fn().mockReturnValue({
      project: {
        name: 'Test Project',
        shortName: 'test',
        domain: 'test.com',
      },
    });

    return {
      mockExecAsync,
      mockFsRm,
      mockFsMkdir,
      mockOctokitPullsCreate,
      MockOctokit,
      mockGetConfig,
    };
  });

vi.mock('util', () => ({
  promisify: () => mockExecAsync,
}));

vi.mock('fs/promises', () => ({
  default: {
    rm: mockFsRm,
    mkdir: mockFsMkdir,
  },
  rm: mockFsRm,
  mkdir: mockFsMkdir,
}));

vi.mock('@octokit/rest', () => ({
  Octokit: MockOctokit,
}));

vi.mock('../server/config/loader.js', () => ({
  getConfig: mockGetConfig,
}));

import { GitHubPRService } from '../server/stream/services/github-pr-service.js';

describe('GitHubPRService', () => {
  let service: GitHubPRService;
  const defaultConfig = {
    token: 'test-token',
    targetRepo: 'owner/repo',
    sourceRepo: 'source/repo',
    baseBranch: 'main',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockReset();
    mockFsRm.mockReset();
    mockFsMkdir.mockReset();
    mockOctokitPullsCreate.mockReset();

    // Default mock implementations
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockFsRm.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);

    service = new GitHubPRService(defaultConfig);
  });

  describe('constructor', () => {
    it('should create instance with default work directory', () => {
      const svc = new GitHubPRService(defaultConfig);
      expect(svc).toBeInstanceOf(GitHubPRService);
    });

    it('should create instance with custom work directory', () => {
      const svc = new GitHubPRService(defaultConfig, '/custom/workdir');
      expect(svc).toBeInstanceOf(GitHubPRService);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = service.getConfig();

      expect(config).toEqual(defaultConfig);
      // Verify it's a copy, not the same reference
      expect(config).not.toBe(defaultConfig);
    });
  });

  describe('cloneRepository', () => {
    it('should clone repository successfully', async () => {
      mockFsRm.mockResolvedValue(undefined);
      mockFsMkdir.mockResolvedValue(undefined);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.cloneRepository('batch-123');

      expect(result).toBe('/tmp/pr-workspaces/batch-batch-123');
      expect(mockFsRm).toHaveBeenCalled();
      expect(mockFsMkdir).toHaveBeenCalledWith('/tmp/pr-workspaces', { recursive: true });
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.any(Object)
      );
    });

    it('should handle directory removal error gracefully', async () => {
      mockFsRm.mockRejectedValue(new Error('Directory not found'));
      mockFsMkdir.mockResolvedValue(undefined);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.cloneRepository('batch-456');

      expect(result).toBe('/tmp/pr-workspaces/batch-batch-456');
    });

    it('should throw error when git clone fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('git clone failed'));

      await expect(service.cloneRepository('batch-789')).rejects.toThrow(
        'Failed to clone repository: git clone failed'
      );
    });

    it('should configure git user after cloning', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.cloneRepository('batch-123');

      // Should call git config for user.name and user.email
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git config user.name'),
        expect.any(Object)
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git config user.email'),
        expect.any(Object)
      );
    });

    it('should checkout base branch after cloning', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.cloneRepository('batch-123');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git checkout main'),
        expect.any(Object)
      );
    });
  });

  describe('createBranch', () => {
    it('should create a new branch', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.createBranch('/path/to/repo', 'feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith('git checkout -b feature-branch', {
        cwd: '/path/to/repo',
      });
    });

    it('should throw error when branch creation fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('branch already exists'));

      await expect(service.createBranch('/path/to/repo', 'existing-branch')).rejects.toThrow(
        'Failed to create branch: branch already exists'
      );
    });
  });

  describe('commitChanges', () => {
    it('should stage and commit changes', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add
        .mockResolvedValueOnce({ stdout: 'M file.txt', stderr: '' }) // git status
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // git commit

      await service.commitChanges('/path/to/repo', 'Test commit message');

      expect(mockExecAsync).toHaveBeenCalledWith('git add .', { cwd: '/path/to/repo' });
      expect(mockExecAsync).toHaveBeenCalledWith('git status --porcelain', {
        cwd: '/path/to/repo',
      });
      expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('git commit -m'), {
        cwd: '/path/to/repo',
      });
    });

    it('should not commit if no changes', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // git status (empty)

      await service.commitChanges('/path/to/repo', 'Test message');

      // Should not call git commit
      expect(mockExecAsync).toHaveBeenCalledTimes(2);
    });

    it('should escape quotes in commit message', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'M file.txt', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.commitChanges('/path/to/repo', 'Message with "quotes"');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('\\"quotes\\"'),
        expect.any(Object)
      );
    });

    it('should throw error when commit fails', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'M file.txt', stderr: '' })
        .mockRejectedValueOnce(new Error('commit failed'));

      await expect(service.commitChanges('/path/to/repo', 'Test')).rejects.toThrow(
        'Failed to commit changes: commit failed'
      );
    });
  });

  describe('pushBranch', () => {
    it('should set remote URL and push branch', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.pushBranch('/path/to/repo', 'feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git remote set-url origin'),
        { cwd: '/path/to/repo' }
      );
      expect(mockExecAsync).toHaveBeenCalledWith('git push -u origin feature-branch', {
        cwd: '/path/to/repo',
      });
    });

    it('should include token in remote URL', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.pushBranch('/path/to/repo', 'feature-branch');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('test-token@github.com'),
        expect.any(Object)
      );
    });

    it('should throw error when push fails', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // set-url
        .mockRejectedValueOnce(new Error('push rejected'));

      await expect(service.pushBranch('/path/to/repo', 'feature-branch')).rejects.toThrow(
        'Failed to push branch: push rejected'
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request', async () => {
      mockOctokitPullsCreate.mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/pull/42',
          number: 42,
        },
      });

      const result = await service.createPullRequest({
        title: 'Test PR',
        body: 'PR description',
        branchName: 'feature-branch',
      });

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
        branchName: 'feature-branch',
      });
      expect(mockOctokitPullsCreate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'Test PR',
        body: 'PR description',
        head: 'feature-branch',
        base: 'main',
        draft: true,
      });
    });

    it('should create draft PR by default', async () => {
      mockOctokitPullsCreate.mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/pull/1',
          number: 1,
        },
      });

      await service.createPullRequest({
        title: 'Test PR',
        body: 'Description',
        branchName: 'branch',
      });

      expect(mockOctokitPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          draft: true,
        })
      );
    });

    it('should allow non-draft PR', async () => {
      mockOctokitPullsCreate.mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/pull/1',
          number: 1,
        },
      });

      await service.createPullRequest({
        title: 'Test PR',
        body: 'Description',
        branchName: 'branch',
        draft: false,
      });

      expect(mockOctokitPullsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          draft: false,
        })
      );
    });

    it('should throw error when PR creation fails', async () => {
      mockOctokitPullsCreate.mockRejectedValue(new Error('API error'));

      await expect(
        service.createPullRequest({
          title: 'Test PR',
          body: 'Description',
          branchName: 'branch',
        })
      ).rejects.toThrow('Failed to create pull request: API error');
    });
  });

  describe('createPRFromChanges', () => {
    it('should orchestrate the complete PR workflow', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'M file.txt', stderr: '' });
      mockOctokitPullsCreate.mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/pull/99',
          number: 99,
        },
      });

      const result = await service.createPRFromChanges(
        'batch-123',
        'feature-branch',
        'Commit message',
        {
          title: 'PR Title',
          body: 'PR Body',
          branchName: 'feature-branch',
        }
      );

      expect(result).toEqual({
        repoPath: expect.stringContaining('batch-batch-123'),
        pr: {
          url: 'https://github.com/owner/repo/pull/99',
          number: 99,
          branchName: 'feature-branch',
        },
      });
    });
  });

  describe('cleanup', () => {
    it('should remove repository directory', async () => {
      mockFsRm.mockResolvedValue(undefined);

      await service.cleanup('/path/to/repo');

      expect(mockFsRm).toHaveBeenCalledWith('/path/to/repo', { recursive: true, force: true });
    });

    it('should not throw on cleanup failure', async () => {
      mockFsRm.mockRejectedValue(new Error('Permission denied'));

      // Should not throw
      await expect(service.cleanup('/path/to/repo')).resolves.not.toThrow();
    });
  });
});

describe('GitHubPRService with different configs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockFsRm.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);
  });

  it('should work with different base branch', async () => {
    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'org/project',
      sourceRepo: 'fork/project',
      baseBranch: 'develop',
    });

    await service.cloneRepository('test');

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('git checkout develop'),
      expect.any(Object)
    );
  });

  it('should use custom work directory', async () => {
    const service = new GitHubPRService(
      {
        token: 'token',
        targetRepo: 'org/project',
        sourceRepo: 'fork/project',
        baseBranch: 'main',
      },
      '/custom/path'
    );

    const result = await service.cloneRepository('test');

    expect(result).toContain('/custom/path');
    expect(mockFsMkdir).toHaveBeenCalledWith('/custom/path', { recursive: true });
  });

  it('should handle repo with org prefix correctly', async () => {
    mockOctokitPullsCreate.mockResolvedValue({
      data: { html_url: 'url', number: 1 },
    });

    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'my-organization/my-repo',
      sourceRepo: 'source/repo',
      baseBranch: 'main',
    });

    await service.createPullRequest({
      title: 'Test',
      body: 'Body',
      branchName: 'branch',
    });

    expect(mockOctokitPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'my-organization',
        repo: 'my-repo',
      })
    );
  });
});

describe('GitHubPRService edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockFsRm.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);
  });

  it('should handle batch ID with special characters', async () => {
    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'owner/repo',
      sourceRepo: 'source/repo',
      baseBranch: 'main',
    });

    const result = await service.cloneRepository('batch-with-dashes-123');

    expect(result).toContain('batch-batch-with-dashes-123');
  });

  it('should handle empty git status output', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git add
      .mockResolvedValueOnce({ stdout: '   ', stderr: '' }); // git status (whitespace only)

    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'owner/repo',
      sourceRepo: 'source/repo',
      baseBranch: 'main',
    });

    await service.commitChanges('/path', 'message');

    // Should not proceed to commit
    expect(mockExecAsync).toHaveBeenCalledTimes(2);
  });

  it('should get bot name from config', async () => {
    mockGetConfig.mockReturnValue({
      project: {
        name: 'Custom Project',
        shortName: 'custom',
        domain: 'custom.io',
      },
    });

    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'owner/repo',
      sourceRepo: 'source/repo',
      baseBranch: 'main',
    });

    await service.cloneRepository('test');

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('Custom Project Bot'),
      expect.any(Object)
    );
  });

  it('should use shortName when domain not available', async () => {
    mockGetConfig.mockReturnValue({
      project: {
        name: 'No Domain Project',
        shortName: 'nodomain',
        domain: undefined,
      },
    });

    const service = new GitHubPRService({
      token: 'token',
      targetRepo: 'owner/repo',
      sourceRepo: 'source/repo',
      baseBranch: 'main',
    });

    await service.cloneRepository('test');

    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('nodomain'),
      expect.any(Object)
    );
  });
});
