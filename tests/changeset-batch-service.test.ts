/**
 * ChangesetBatchService Unit Tests
 * Tests for creating, managing, and deleting changeset batches

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks for module-level imports
const mockGitHubServiceInstance = vi.hoisted(() => ({
  cloneRepository: vi.fn(),
  createBranch: vi.fn(),
  commitChanges: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
  cleanup: vi.fn(),
}));

const mockFileModServiceInstance = vi.hoisted(() => ({
  applyProposalsToFile: vi.fn(),
}));

const mockFileConsolidation = vi.hoisted(() => ({
  shouldConsolidate: vi.fn().mockReturnValue(false),
  consolidateFile: vi.fn(),
}));

const mockFsReadFile = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn());

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
  },
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
}));

// Mock path module
vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
  join: (...args: string[]) => args.join('/'),
}));

// Mock GitHub PR service
vi.mock('../server/stream/services/github-pr-service.js', () => ({
  GitHubPRService: class MockGitHubPRService {
    cloneRepository = mockGitHubServiceInstance.cloneRepository;
    createBranch = mockGitHubServiceInstance.createBranch;
    commitChanges = mockGitHubServiceInstance.commitChanges;
    pushBranch = mockGitHubServiceInstance.pushBranch;
    createPullRequest = mockGitHubServiceInstance.createPullRequest;
    cleanup = mockGitHubServiceInstance.cleanup;
  },
}));

// Mock File Modification service
vi.mock('../server/stream/services/file-modification-service.js', () => ({
  FileModificationService: class MockFileModificationService {
    applyProposalsToFile = mockFileModServiceInstance.applyProposalsToFile;
  },
}));

// Mock File Consolidation service
vi.mock('../server/stream/services/file-consolidation-service.js', () => ({
  fileConsolidationService: mockFileConsolidation,
}));

// Aliases for easier access in tests
const mockGitHubService = mockGitHubServiceInstance;
const mockFileModService = mockFileModServiceInstance;
const mockFsPromises = { readFile: mockFsReadFile, writeFile: mockFsWriteFile };

import { ChangesetBatchService } from '../server/stream/services/changeset-batch-service.js';

// Mock Prisma client
const mockPrismaClient = {
  docProposal: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  changesetBatch: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  batchProposal: {
    createMany: vi.fn(),
  },
  proposalFailure: {
    create: vi.fn(),
  },
};

describe('ChangesetBatchService', () => {
  let service: ChangesetBatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChangesetBatchService(mockPrismaClient as any);
  });

  describe('constructor', () => {
    it('should create a valid service instance', () => {
      expect(service).toBeInstanceOf(ChangesetBatchService);
    });
  });

  describe('createDraftBatch', () => {
    it('should create a draft batch from approved proposals', async () => {
      const mockProposals = [
        { id: 1, page: 'docs/intro.md', status: 'approved' },
        { id: 2, page: 'docs/api.md', status: 'approved' },
        { id: 3, page: 'docs/intro.md', status: 'approved' },
      ];

      const mockBatch = {
        id: 1,
        batchId: 'batch-1234567890',
        status: 'draft',
        totalProposals: 3,
        affectedFiles: ['docs/intro.md', 'docs/api.md'],
        prTitle: null,
        prBody: null,
      };

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockResolvedValue(mockBatch);
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 3 });

      const result = await service.createDraftBatch([1, 2, 3]);

      expect(result).toEqual(mockBatch);
      expect(mockPrismaClient.docProposal.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [1, 2, 3] },
          status: 'approved',
        },
      });
      expect(mockPrismaClient.changesetBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'draft',
          totalProposals: 3,
          affectedFiles: expect.arrayContaining(['docs/intro.md', 'docs/api.md']),
        }),
      });
      expect(mockPrismaClient.batchProposal.createMany).toHaveBeenCalled();
    });

    it('should throw error when no approved proposals found', async () => {
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);

      await expect(service.createDraftBatch([1, 2, 3])).rejects.toThrow(
        'No approved proposals found'
      );
    });

    it('should deduplicate affected files', async () => {
      const mockProposals = [
        { id: 1, page: 'docs/intro.md', status: 'approved' },
        { id: 2, page: 'docs/intro.md', status: 'approved' },
        { id: 3, page: 'docs/intro.md', status: 'approved' },
      ];

      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        totalProposals: 3,
        affectedFiles: ['docs/intro.md'],
        prTitle: null,
        prBody: null,
      };

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockResolvedValue(mockBatch);
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 3 });

      await service.createDraftBatch([1, 2, 3]);

      expect(mockPrismaClient.changesetBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          affectedFiles: ['docs/intro.md'],
        }),
      });
    });

    it('should generate batch ID with timestamp prefix', async () => {
      const mockProposals = [{ id: 1, page: 'docs/intro.md', status: 'approved' }];

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockImplementation((args) =>
        Promise.resolve({
          id: 1,
          ...args.data,
        })
      );
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 1 });

      await service.createDraftBatch([1]);

      const createCall = mockPrismaClient.changesetBatch.create.mock.calls[0][0];
      expect(createCall.data.batchId).toMatch(/^batch-\d+$/);
    });
  });

  describe('getBatch', () => {
    it('should return batch with proposals and failures', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        batchProposals: [{ id: 1, proposalId: 1, proposal: { id: 1, page: 'docs/intro.md' } }],
        failures: [],
      };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      const result = await service.getBatch(1);

      expect(result).toEqual(mockBatch);
      expect(mockPrismaClient.changesetBatch.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          batchProposals: {
            include: { proposal: true },
            orderBy: { orderIndex: 'asc' },
          },
          failures: {
            include: { proposal: true },
          },
        },
      });
    });

    it('should return null for non-existent batch', async () => {
      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(null);

      const result = await service.getBatch(999);

      expect(result).toBeNull();
    });
  });

  describe('listBatches', () => {
    it('should return all batches when no status filter', async () => {
      const mockBatches = [
        { id: 1, status: 'draft', batchProposals: [], failures: [] },
        { id: 2, status: 'submitted', batchProposals: [], failures: [] },
      ];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);

      const result = await service.listBatches();

      expect(result).toEqual(mockBatches);
      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith({
        where: undefined,
        include: {
          batchProposals: {
            include: { proposal: true },
          },
          failures: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter batches by draft status', async () => {
      const mockBatches = [{ id: 1, status: 'draft', batchProposals: [], failures: [] }];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);

      const result = await service.listBatches('draft');

      expect(result).toEqual(mockBatches);
      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith({
        where: { status: 'draft' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter batches by submitted status', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);

      await service.listBatches('submitted');

      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith({
        where: { status: 'submitted' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter batches by merged status', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);

      await service.listBatches('merged');

      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith({
        where: { status: 'merged' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter batches by closed status', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);

      await service.listBatches('closed');

      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith({
        where: { status: 'closed' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no batches found', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);

      const result = await service.listBatches('draft');

      expect(result).toEqual([]);
    });
  });

  describe('deleteDraftBatch', () => {
    it('should delete a draft batch', async () => {
      const mockBatch = { id: 1, status: 'draft' };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
      mockPrismaClient.changesetBatch.delete.mockResolvedValue(mockBatch);

      await service.deleteDraftBatch(1);

      expect(mockPrismaClient.changesetBatch.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw error when batch not found', async () => {
      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(null);

      await expect(service.deleteDraftBatch(999)).rejects.toThrow('Batch not found: 999');
    });

    it('should throw error when trying to delete non-draft batch', async () => {
      const mockBatch = { id: 1, status: 'submitted' };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      await expect(service.deleteDraftBatch(1)).rejects.toThrow(
        'Cannot delete non-draft batch: submitted'
      );
    });

    it('should throw error when trying to delete merged batch', async () => {
      const mockBatch = { id: 1, status: 'merged' };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      await expect(service.deleteDraftBatch(1)).rejects.toThrow(
        'Cannot delete non-draft batch: merged'
      );
    });

    it('should throw error when trying to delete closed batch', async () => {
      const mockBatch = { id: 1, status: 'closed' };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      await expect(service.deleteDraftBatch(1)).rejects.toThrow(
        'Cannot delete non-draft batch: closed'
      );
    });
  });

  describe('generatePR', () => {
    it('should throw error when batch not found', async () => {
      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(null);

      await expect(
        service.generatePR(999, {
          proposalIds: [1],
          targetRepo: 'owner/repo',
          sourceRepo: 'owner/repo',
          prTitle: 'Test PR',
          prBody: 'Test body',
          submittedBy: 'tester',
        })
      ).rejects.toThrow('Batch not found: 999');
    });

    it('should throw error when batch is not in draft status', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'submitted',
        batchProposals: [],
      };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      await expect(
        service.generatePR(1, {
          proposalIds: [1],
          targetRepo: 'owner/repo',
          sourceRepo: 'owner/repo',
          prTitle: 'Test PR',
          prBody: 'Test body',
          submittedBy: 'tester',
        })
      ).rejects.toThrow('Batch is not in draft status: submitted');
    });

    it('should throw error when batch is merged', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'merged',
        batchProposals: [],
      };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      await expect(
        service.generatePR(1, {
          proposalIds: [1],
          targetRepo: 'owner/repo',
          sourceRepo: 'owner/repo',
          prTitle: 'Test PR',
          prBody: 'Test body',
          submittedBy: 'tester',
        })
      ).rejects.toThrow('Batch is not in draft status: merged');
    });
  });
});

describe('ChangesetBatchService Edge Cases', () => {
  let service: ChangesetBatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChangesetBatchService(mockPrismaClient as any);
  });

  describe('createDraftBatch edge cases', () => {
    it('should handle single proposal', async () => {
      const mockProposals = [{ id: 1, page: 'docs/intro.md', status: 'approved' }];

      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        totalProposals: 1,
        affectedFiles: ['docs/intro.md'],
      };

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockResolvedValue(mockBatch);
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 1 });

      const result = await service.createDraftBatch([1]);

      expect(result.totalProposals).toBe(1);
    });

    it('should handle many proposals with same file', async () => {
      const mockProposals = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        page: 'docs/intro.md',
        status: 'approved',
      }));

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockResolvedValue({
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        totalProposals: 10,
        affectedFiles: ['docs/intro.md'],
      });
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 10 });

      const result = await service.createDraftBatch(mockProposals.map((p) => p.id));

      expect(result.totalProposals).toBe(10);
    });

    it('should handle proposals with different files', async () => {
      const mockProposals = [
        { id: 1, page: 'docs/intro.md', status: 'approved' },
        { id: 2, page: 'docs/api.md', status: 'approved' },
        { id: 3, page: 'docs/guide.md', status: 'approved' },
      ];

      mockPrismaClient.docProposal.findMany.mockResolvedValue(mockProposals);
      mockPrismaClient.changesetBatch.create.mockImplementation((args) =>
        Promise.resolve({
          id: 1,
          ...args.data,
        })
      );
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 3 });

      await service.createDraftBatch([1, 2, 3]);

      const createCall = mockPrismaClient.changesetBatch.create.mock.calls[0][0];
      expect(createCall.data.affectedFiles).toContain('docs/intro.md');
      expect(createCall.data.affectedFiles).toContain('docs/api.md');
      expect(createCall.data.affectedFiles).toContain('docs/guide.md');
    });

    it('should only include approved proposals', async () => {
      // If we request IDs that are not approved, they won't be in the result
      mockPrismaClient.docProposal.findMany.mockResolvedValue([
        { id: 1, page: 'docs/intro.md', status: 'approved' },
      ]);

      mockPrismaClient.changesetBatch.create.mockResolvedValue({
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        totalProposals: 1,
        affectedFiles: ['docs/intro.md'],
      });
      mockPrismaClient.batchProposal.createMany.mockResolvedValue({ count: 1 });

      const result = await service.createDraftBatch([1, 2, 3]); // 2 and 3 not approved

      expect(result.totalProposals).toBe(1);
    });
  });

  describe('listBatches edge cases', () => {
    it('should return batches with empty proposals array', async () => {
      const mockBatches = [{ id: 1, status: 'draft', batchProposals: [], failures: [] }];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);

      const result = await service.listBatches();

      expect(result[0].batchProposals).toEqual([]);
    });

    it('should return batches with failures', async () => {
      const mockBatches = [
        {
          id: 1,
          status: 'submitted',
          batchProposals: [],
          failures: [{ id: 1, failureType: 'parse_error', errorMessage: 'Test error' }],
        },
      ];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);

      const result = await service.listBatches('submitted');

      expect(result[0].failures).toHaveLength(1);
    });
  });

  describe('getBatch edge cases', () => {
    it('should return batch with multiple proposals', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        batchProposals: [
          { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/a.md' } },
          { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/b.md' } },
          { id: 3, proposalId: 3, orderIndex: 2, proposal: { id: 3, page: 'docs/c.md' } },
        ],
        failures: [],
      };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      const result = await service.getBatch(1);

      expect(result?.batchProposals).toHaveLength(3);
    });

    it('should return batch with failures', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'submitted',
        batchProposals: [],
        failures: [
          { id: 1, failureType: 'file_not_found', errorMessage: 'File not found' },
          { id: 2, failureType: 'parse_error', errorMessage: 'Parse failed' },
        ],
      };

      mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);

      const result = await service.getBatch(1);

      expect(result?.failures).toHaveLength(2);
    });
  });
});

describe('ChangesetBatchService - generatePR workflow', () => {
  let service: ChangesetBatchService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GITHUB_TOKEN = 'test-github-token';
    service = new ChangesetBatchService(mockPrismaClient as any);

    // Reset all mock functions
    mockGitHubService.cloneRepository.mockReset();
    mockGitHubService.createBranch.mockReset();
    mockGitHubService.commitChanges.mockReset();
    mockGitHubService.pushBranch.mockReset();
    mockGitHubService.createPullRequest.mockReset();
    mockGitHubService.cleanup.mockReset();
    mockFileModService.applyProposalsToFile.mockReset();
    mockFileConsolidation.shouldConsolidate.mockReset();
    mockFsPromises.readFile.mockReset();
    mockFsPromises.writeFile.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createBatchOptions = {
    proposalIds: [1, 2],
    targetRepo: 'owner/target-repo',
    sourceRepo: 'owner/source-repo',
    baseBranch: 'main',
    prTitle: 'Test PR Title',
    prBody: 'Test PR body content',
    submittedBy: 'test-user',
  };

  it('should successfully generate PR with mechanical application', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-123',
      status: 'draft',
      totalProposals: 2,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/intro.md' } },
        { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/api.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockResolvedValue('# Original content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified content');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({
      url: 'https://github.com/owner/repo/pull/123',
      number: 123,
    });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({ ...mockBatch, status: 'submitted' });
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    const result = await service.generatePR(1, createBatchOptions);

    expect(result.appliedProposals).toContain(1);
    expect(result.appliedProposals).toContain(2);
    expect(result.pr?.url).toBe('https://github.com/owner/repo/pull/123');
    expect(mockGitHubService.cloneRepository).toHaveBeenCalled();
    expect(mockGitHubService.createPullRequest).toHaveBeenCalled();
    expect(mockGitHubService.cleanup).toHaveBeenCalled();
  });

  it('should use LLM consolidation when shouldConsolidate returns true', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-456',
      status: 'draft',
      totalProposals: 1,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/intro.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockResolvedValue('# Original content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(true);
    mockFileConsolidation.consolidateFile.mockResolvedValue({
      consolidatedContent: '# LLM consolidated content',
    });
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({
      url: 'https://github.com/owner/repo/pull/456',
      number: 456,
    });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await service.generatePR(1, createBatchOptions);

    expect(mockFileConsolidation.consolidateFile).toHaveBeenCalled();
    expect(mockFileModService.applyProposalsToFile).not.toHaveBeenCalled();
  });

  it('should handle file application failure and track in failures', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-789',
      status: 'draft',
      totalProposals: 2,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/failing.md' } },
        { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/success.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');

    // First file fails to read
    mockFsPromises.readFile
      .mockRejectedValueOnce(new Error('file not found'))
      .mockResolvedValueOnce('# Success content');

    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.proposalFailure.create.mockResolvedValue({});
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({
      url: 'https://github.com/owner/repo/pull/789',
      number: 789,
    });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    const result = await service.generatePR(1, createBatchOptions);

    expect(result.failedProposals).toHaveLength(1);
    expect(result.failedProposals[0].errorType).toBe('file_not_found');
    expect(result.appliedProposals).toContain(2);
    expect(mockPrismaClient.proposalFailure.create).toHaveBeenCalled();
  });

  it('should throw error when all proposals fail', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-fail',
      status: 'draft',
      totalProposals: 1,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/failing.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockRejectedValue(new Error('file not found'));
    mockPrismaClient.proposalFailure.create.mockResolvedValue({});
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await expect(service.generatePR(1, createBatchOptions)).rejects.toThrow(
      'PR generation failed: No proposals could be applied. All failed.'
    );

    expect(mockGitHubService.cleanup).toHaveBeenCalled();
  });

  it('should classify different error types correctly', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-errors',
      status: 'draft',
      totalProposals: 3,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/a.md' } },
        { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/b.md' } },
        { id: 3, proposalId: 3, orderIndex: 2, proposal: { id: 3, page: 'docs/c.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');

    // Different error types
    mockFsPromises.readFile
      .mockRejectedValueOnce(new Error('section not found in document'))
      .mockRejectedValueOnce(new Error('git command failed'))
      .mockRejectedValueOnce(new Error('unexpected parse error'));

    mockPrismaClient.proposalFailure.create.mockResolvedValue({});
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await expect(service.generatePR(1, createBatchOptions)).rejects.toThrow();

    // Verify different error types were classified
    const failureCalls = mockPrismaClient.proposalFailure.create.mock.calls;
    expect(failureCalls[0][0].data.failureType).toBe('section_not_found');
    expect(failureCalls[1][0].data.failureType).toBe('git_error');
    expect(failureCalls[2][0].data.failureType).toBe('parse_error');
  });

  it('should cleanup on error during PR workflow', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-cleanup',
      status: 'draft',
      totalProposals: 1,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/intro.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockResolvedValue('# Content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockRejectedValue(new Error('Branch creation failed'));
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await expect(service.generatePR(1, createBatchOptions)).rejects.toThrow(
      'PR generation failed: Branch creation failed'
    );

    expect(mockGitHubService.cleanup).toHaveBeenCalledWith('/tmp/repo-clone');
  });

  it('should use default baseBranch when not provided', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-default',
      status: 'draft',
      totalProposals: 1,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/intro.md' } },
      ],
    };

    const optionsWithoutBranch = {
      ...createBatchOptions,
      baseBranch: undefined,
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockResolvedValue('# Content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({ url: 'url', number: 1 });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await service.generatePR(1, optionsWithoutBranch);

    // Verify update includes default baseBranch
    expect(mockPrismaClient.changesetBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseBranch: 'main',
        }),
      })
    );
  });

  it('should group proposals by file correctly', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-grouped',
      status: 'draft',
      totalProposals: 4,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/intro.md' } },
        { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/api.md' } },
        { id: 3, proposalId: 3, orderIndex: 2, proposal: { id: 3, page: 'docs/intro.md' } },
        { id: 4, proposalId: 4, orderIndex: 3, proposal: { id: 4, page: 'docs/intro.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile.mockResolvedValue('# Content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({ url: 'url', number: 1 });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    const result = await service.generatePR(1, createBatchOptions);

    // All 4 proposals should be applied
    expect(result.appliedProposals).toHaveLength(4);
    // Files should be processed: intro.md has 3 proposals, api.md has 1
    // readFile should be called twice (once per unique file)
    expect(mockFsPromises.readFile).toHaveBeenCalledTimes(2);
  });

  it('should generate correct PR body with failures', async () => {
    const mockBatch = {
      id: 1,
      batchId: 'batch-body',
      status: 'draft',
      totalProposals: 2,
      batchProposals: [
        { id: 1, proposalId: 1, orderIndex: 0, proposal: { id: 1, page: 'docs/fail.md' } },
        { id: 2, proposalId: 2, orderIndex: 1, proposal: { id: 2, page: 'docs/success.md' } },
      ],
    };

    mockPrismaClient.changesetBatch.findUnique.mockResolvedValue(mockBatch);
    mockGitHubService.cloneRepository.mockResolvedValue('/tmp/repo-clone');
    mockFsPromises.readFile
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce('# Content');
    mockFileConsolidation.shouldConsolidate.mockReturnValue(false);
    mockFileModService.applyProposalsToFile.mockResolvedValue('# Modified');
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockPrismaClient.proposalFailure.create.mockResolvedValue({});
    mockPrismaClient.docProposal.update.mockResolvedValue({});
    mockGitHubService.createBranch.mockResolvedValue(undefined);
    mockGitHubService.commitChanges.mockResolvedValue(undefined);
    mockGitHubService.pushBranch.mockResolvedValue(undefined);
    mockGitHubService.createPullRequest.mockResolvedValue({ url: 'url', number: 1 });
    mockPrismaClient.changesetBatch.update.mockResolvedValue({});
    mockGitHubService.cleanup.mockResolvedValue(undefined);

    await service.generatePR(1, createBatchOptions);

    // Check PR body includes warning about failures
    const prCall = mockGitHubService.createPullRequest.mock.calls[0][0];
    expect(prCall.body).toContain('Successfully applied: 1 proposals');
    expect(prCall.body).toContain('Failed to apply: 1 proposals');
    expect(prCall.body).toContain('Warning');
  });
});
