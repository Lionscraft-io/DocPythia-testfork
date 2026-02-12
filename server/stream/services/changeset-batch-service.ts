/**
 * ChangesetBatchService
 *
 * Orchestrates the complete PR generation workflow:
 * 1. Create changeset batch from approved proposals
 * 2. Clone target repository
 * 3. Apply file modifications
 * 4. Track failures
 * 5. Create PR on GitHub
 * 6. Update batch status and proposal records
 *

 * @created 2025-11-06
 */

import { PrismaClient, DocProposal, ChangesetBatch } from '@prisma/client';
import { FileModificationService } from './file-modification-service';
import { GitHubPRService } from './github-pr-service';
import { fileConsolidationService } from './file-consolidation-service';

interface CreateBatchOptions {
  proposalIds: number[];
  targetRepo: string;
  sourceRepo: string;
  baseBranch?: string;
  prTitle: string;
  prBody: string;
  submittedBy: string;
}

interface BatchResult {
  batch: ChangesetBatch;
  pr?: {
    url: string;
    number: number;
  };
  appliedProposals: number[];
  failedProposals: Array<{
    proposalId: number;
    error: string;
    errorType: string;
  }>;
}

export class ChangesetBatchService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a draft changeset batch from approved proposals
   */
  async createDraftBatch(proposalIds: number[]): Promise<ChangesetBatch> {
    // Fetch proposals
    const proposals = await this.prisma.docProposal.findMany({
      where: {
        id: { in: proposalIds },
        status: 'approved',
      },
    });

    if (proposals.length === 0) {
      throw new Error('No approved proposals found');
    }

    // Group by file to get affected files list
    const affectedFiles = [...new Set(proposals.map((p) => p.page))];

    // Generate batch ID (timestamp-based)
    const batchId = `batch-${Date.now()}`;

    // Create batch record
    const batch = await this.prisma.changesetBatch.create({
      data: {
        batchId,
        status: 'draft',
        totalProposals: proposals.length,
        affectedFiles,
        prTitle: null,
        prBody: null,
      },
    });

    // Link proposals to batch via junction table
    await this.prisma.batchProposal.createMany({
      data: proposals.map((p, index) => ({
        batchId: batch.id,
        proposalId: p.id,
        orderIndex: index,
      })),
    });

    return batch;
  }

  /**
   * Generate PR from a draft batch
   */
  async generatePR(batchId: number, options: CreateBatchOptions): Promise<BatchResult> {
    // Fetch batch with proposals
    const batch = await this.prisma.changesetBatch.findUnique({
      where: { id: batchId },
      include: {
        batchProposals: {
          include: { proposal: true },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (batch.status !== 'draft') {
      throw new Error(`Batch is not in draft status: ${batch.status}`);
    }

    const proposals = batch.batchProposals.map((bp) => bp.proposal);

    // Initialize GitHub PR service
    const githubConfig = {
      token: process.env.GITHUB_TOKEN!,
      targetRepo: options.targetRepo,
      sourceRepo: options.sourceRepo,
      baseBranch: options.baseBranch || 'main',
    };

    const githubService = new GitHubPRService(githubConfig);

    // Generate branch name
    const projectShortName = process.env.PROJECT_SHORT_NAME || 'docpythia';
    const branchName = `${projectShortName}-updates-${batch.batchId}`;

    let repoPath: string | null = null;
    const appliedProposals: number[] = [];
    const failedProposals: Array<{
      proposalId: number;
      error: string;
      errorType: string;
    }> = [];

    try {
      // Clone repository
      repoPath = await githubService.cloneRepository(batch.batchId);

      // Initialize file modification service
      const fileService = new FileModificationService(repoPath);

      // Group proposals by file
      const proposalsByFile = this.groupProposalsByFile(proposals);

      // Apply proposals file by file
      for (const [filePath, fileProposals] of Object.entries(proposalsByFile)) {
        try {
          // Read the original file content
          const fs = await import('fs/promises');
          const path = await import('path');
          const fullPath = path.join(repoPath, filePath);

          console.log(`\n📄 Processing file: ${filePath}`);
          console.log(`   Full path: ${fullPath}`);
          console.log(`   Proposals: ${fileProposals.length}`);

          // Log proposal details for debugging
          for (const p of fileProposals) {
            console.log(`   📋 Proposal #${p.id}:`);
            console.log(`      updateType: ${p.updateType}`);
            console.log(`      section: ${p.section || '(null)'}`);
            console.log(`      location: ${JSON.stringify(p.location) || '(null)'}`);
            console.log(`      suggestedText length: ${p.suggestedText?.length || 0} chars`);
          }

          const originalContent = await fs.readFile(fullPath, 'utf-8');

          let modifiedContent: string;

          // Decide whether to use LLM consolidation or mechanical application
          if (fileConsolidationService.shouldConsolidate(fileProposals, originalContent)) {
            console.log(
              `\n🤖 Using LLM consolidation for ${filePath} (${fileProposals.length} proposals)`
            );

            // Use LLM to consolidate changes
            const result = await fileConsolidationService.consolidateFile(
              filePath,
              originalContent,
              fileProposals
            );
            modifiedContent = result.consolidatedContent;
          } else {
            console.log(
              `\n⚙️  Using mechanical application for ${filePath} (${fileProposals.length} proposals)`
            );

            // Use traditional mechanical application
            modifiedContent = await fileService.applyProposalsToFile(filePath, fileProposals);
          }

          // Write the modified content back to the file
          await fs.writeFile(fullPath, modifiedContent, 'utf-8');

          // Mark proposals as successfully applied
          for (const proposal of fileProposals) {
            await this.prisma.docProposal.update({
              where: { id: proposal.id },
              data: {
                prBatchId: batch.id,
                prApplicationStatus: 'success',
              },
            });
            appliedProposals.push(proposal.id);
          }
        } catch (error: any) {
          console.error(`\n❌ Failed to process file: ${filePath}`);
          console.error(`   Error: ${error.message}`);

          // Track failures for this file's proposals
          for (const proposal of fileProposals) {
            const errorType = this.classifyError(error);

            // Create failure record
            await this.prisma.proposalFailure.create({
              data: {
                batchId: batch.id,
                proposalId: proposal.id,
                failureType: errorType,
                errorMessage: error.message || 'Unknown error',
                filePath,
              },
            });

            // Update proposal status
            await this.prisma.docProposal.update({
              where: { id: proposal.id },
              data: {
                prBatchId: batch.id,
                prApplicationStatus: 'failed',
                prApplicationError: error.message,
              },
            });

            failedProposals.push({
              proposalId: proposal.id,
              error: error.message,
              errorType,
            });
          }
        }
      }

      // Check if any proposals were successfully applied
      if (appliedProposals.length === 0) {
        // Include actual failure reasons in the error
        const failureDetails = failedProposals
          .slice(0, 3) // Limit to first 3 failures
          .map((f) => `${f.errorType}: ${f.error}`)
          .join('; ');
        throw new Error(
          `No proposals could be applied. All failed. Errors: ${failureDetails || 'Unknown'}`
        );
      }

      // Create branch
      await githubService.createBranch(repoPath, branchName);

      // Commit changes
      const commitMessage = this.generateCommitMessage(batch, appliedProposals.length);
      await githubService.commitChanges(repoPath, commitMessage);

      // Push branch
      await githubService.pushBranch(repoPath, branchName);

      // Create PR
      const pr = await githubService.createPullRequest({
        title: options.prTitle,
        body: this.generatePRBody(options.prBody, appliedProposals.length, failedProposals.length),
        branchName,
        draft: true,
      });

      // Update batch record
      await this.prisma.changesetBatch.update({
        where: { id: batch.id },
        data: {
          status: 'submitted',
          prTitle: options.prTitle,
          prBody: options.prBody,
          prUrl: pr.url,
          prNumber: pr.number,
          branchName,
          targetRepo: options.targetRepo,
          sourceRepo: options.sourceRepo,
          baseBranch: options.baseBranch || 'main',
          submittedAt: new Date(),
          submittedBy: options.submittedBy,
        },
      });

      // Cleanup
      if (repoPath) {
        await githubService.cleanup(repoPath);
      }

      return {
        batch,
        pr,
        appliedProposals,
        failedProposals,
      };
    } catch (error: any) {
      // Cleanup on error
      if (repoPath) {
        await githubService.cleanup(repoPath);
      }

      throw new Error(`PR generation failed: ${error.message}`);
    }
  }

  /**
   * Get batch with all related data
   */
  async getBatch(batchId: number) {
    return this.prisma.changesetBatch.findUnique({
      where: { id: batchId },
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
  }

  /**
   * List all batches
   */
  async listBatches(status?: 'draft' | 'submitted' | 'merged' | 'closed') {
    return this.prisma.changesetBatch.findMany({
      where: status ? { status } : undefined,
      include: {
        batchProposals: {
          include: { proposal: true },
        },
        failures: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a draft batch
   */
  async deleteDraftBatch(batchId: number): Promise<void> {
    const batch = await this.prisma.changesetBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (batch.status !== 'draft') {
      throw new Error(`Cannot delete non-draft batch: ${batch.status}`);
    }

    // Delete batch (cascade will remove batch_proposals)
    await this.prisma.changesetBatch.delete({
      where: { id: batchId },
    });
  }

  // Helper methods

  private groupProposalsByFile(proposals: DocProposal[]): Record<string, DocProposal[]> {
    const grouped: Record<string, DocProposal[]> = {};

    for (const proposal of proposals) {
      const filePath = proposal.page;
      if (!grouped[filePath]) {
        grouped[filePath] = [];
      }
      grouped[filePath].push(proposal);
    }

    return grouped;
  }

  private classifyError(error: any): string {
    const message = error.message?.toLowerCase() || '';

    if (message.includes('file not found')) return 'file_not_found';
    if (message.includes('section not found')) return 'section_not_found';
    if (message.includes('git')) return 'git_error';

    return 'parse_error';
  }

  private generateCommitMessage(batch: ChangesetBatch, appliedCount: number): string {
    const projectName = process.env.PROJECT_NAME || 'DocPythia';
    return `docs: Apply ${appliedCount} documentation updates from ${projectName}

Batch ID: ${batch.batchId}
Total proposals: ${batch.totalProposals}
Successfully applied: ${appliedCount}

Generated by ${projectName} automated documentation system`;
  }

  private generatePRBody(userBody: string, appliedCount: number, failedCount: number): string {
    const projectName = process.env.PROJECT_NAME || 'DocPythia';
    const projectUrl = process.env.PROJECT_URL || '';

    let body = userBody + '\n\n---\n\n';
    body += `**Batch Statistics:**\n`;
    body += `- Successfully applied: ${appliedCount} proposals\n`;

    if (failedCount > 0) {
      body += `- Failed to apply: ${failedCount} proposals\n`;
      body += `\n**Warning:** Some proposals could not be applied. Review the changeset history for details.\n`;
    }

    if (projectUrl) {
      body += `\nGenerated by [${projectName}](${projectUrl})`;
    } else {
      body += `\nGenerated by ${projectName}`;
    }

    return body;
  }
}
