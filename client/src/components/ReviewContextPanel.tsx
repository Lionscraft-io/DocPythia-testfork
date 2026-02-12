import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  MessageSquare,
  BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * Related documentation item
 */
interface RelatedDoc {
  page: string;
  section: string;
  similarityScore: number;
  matchType: 'semantic' | 'keyword' | 'same-section';
  snippet: string;
}

/**
 * Duplication warning
 */
interface DuplicationWarning {
  detected: boolean;
  matchingPage?: string;
  matchingSection?: string;
  overlapPercentage?: number;
}

/**
 * Style metrics
 */
interface StyleMetrics {
  avgSentenceLength: number;
  usesCodeExamples: boolean;
  formatPattern: 'prose' | 'bullets' | 'mixed';
  technicalDepth: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Style analysis
 */
interface StyleAnalysis {
  targetPageStyle: StyleMetrics;
  proposalStyle: StyleMetrics;
  consistencyNotes: string[];
}

/**
 * Change context
 */
interface ChangeContext {
  targetSectionCharCount: number;
  proposalCharCount: number;
  changePercentage: number;
  lastUpdated: string | null;
  otherPendingProposals: number;
}

/**
 * Source analysis
 */
interface SourceAnalysis {
  messageCount: number;
  uniqueAuthors: number;
  threadHadConsensus: boolean;
  conversationSummary: string;
}

/**
 * Complete enrichment data
 */
export interface ProposalEnrichment {
  relatedDocs: RelatedDoc[];
  duplicationWarning: DuplicationWarning;
  styleAnalysis: StyleAnalysis;
  changeContext: ChangeContext;
  sourceAnalysis: SourceAnalysis;
  enrichedAt: string;
  enrichmentVersion: string;
}

interface ReviewContextPanelProps {
  enrichment: ProposalEnrichment | null | undefined;
  className?: string;
}

export function ReviewContextPanel({ enrichment, className = '' }: ReviewContextPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!enrichment) {
    return null;
  }

  const hasWarnings =
    enrichment.duplicationWarning.detected ||
    enrichment.styleAnalysis.consistencyNotes.length > 0 ||
    enrichment.changeContext.changePercentage > 50 ||
    enrichment.changeContext.otherPendingProposals > 0;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={`${className} border-blue-200 bg-blue-50/50`}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="cursor-pointer hover:bg-blue-100/50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600" />
                <CardTitle className="text-sm font-medium text-blue-900">Review Context</CardTitle>
                {hasWarnings && (
                  <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {enrichment.styleAnalysis.consistencyNotes.length +
                      (enrichment.duplicationWarning.detected ? 1 : 0)}{' '}
                    notes
                  </Badge>
                )}
              </div>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-blue-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-blue-600" />
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Duplication Warning */}
            {enrichment.duplicationWarning.detected && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-900">Potential Duplicate Detected</p>
                    <p className="text-xs text-red-700 mt-1">
                      {enrichment.duplicationWarning.overlapPercentage}% overlap with{' '}
                      <code className="px-1 py-0.5 bg-red-100 rounded">
                        {enrichment.duplicationWarning.matchingPage}
                      </code>
                      {enrichment.duplicationWarning.matchingSection && (
                        <> in section "{enrichment.duplicationWarning.matchingSection}"</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Style Consistency Notes */}
            {enrichment.styleAnalysis.consistencyNotes.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900">Style Consistency Notes</p>
                    <ul className="text-xs text-amber-700 mt-1 space-y-1">
                      {enrichment.styleAnalysis.consistencyNotes.map((note, idx) => (
                        <li key={idx}>• {note}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Related Documentation */}
            {enrichment.relatedDocs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">
                    Related Documentation ({enrichment.relatedDocs.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {enrichment.relatedDocs.slice(0, 3).map((doc, idx) => (
                    <div key={idx} className="p-2 rounded bg-white border border-gray-200 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <code className="text-blue-700 truncate max-w-[200px]">{doc.page}</code>
                        <div className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              doc.matchType === 'same-section'
                                ? 'border-green-300 text-green-700'
                                : doc.matchType === 'semantic'
                                  ? 'border-blue-300 text-blue-700'
                                  : 'border-gray-300 text-gray-600'
                            }`}
                          >
                            {doc.matchType}
                          </Badge>
                          <span className="text-gray-500">
                            {Math.round(doc.similarityScore * 100)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-gray-600 line-clamp-2">{doc.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Change Impact */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-900">Change Impact</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 rounded bg-white border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Change Size</p>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={Math.min(enrichment.changeContext.changePercentage, 100)}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs font-medium">
                      {enrichment.changeContext.changePercentage}%
                    </span>
                  </div>
                </div>
                <div className="p-2 rounded bg-white border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Character Count</p>
                  <p className="text-xs font-medium">
                    {enrichment.changeContext.targetSectionCharCount > 0 ? (
                      <>
                        {enrichment.changeContext.targetSectionCharCount} →{' '}
                        {enrichment.changeContext.proposalCharCount}
                      </>
                    ) : (
                      <>{enrichment.changeContext.proposalCharCount} (new)</>
                    )}
                  </p>
                </div>
                {enrichment.changeContext.otherPendingProposals > 0 && (
                  <div className="col-span-2 p-2 rounded bg-amber-50 border border-amber-200">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <p className="text-xs text-amber-700">
                        {enrichment.changeContext.otherPendingProposals} other pending proposal(s)
                        for this instance
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Source Conversation */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-900">Source Conversation</span>
              </div>
              <div className="p-2 rounded bg-white border border-gray-200">
                <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
                  <span>{enrichment.sourceAnalysis.messageCount} messages</span>
                  <span>{enrichment.sourceAnalysis.uniqueAuthors} authors</span>
                  {enrichment.sourceAnalysis.threadHadConsensus && (
                    <Badge className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Consensus
                    </Badge>
                  )}
                </div>
                {enrichment.sourceAnalysis.conversationSummary && (
                  <p className="text-xs text-gray-600 line-clamp-2">
                    {enrichment.sourceAnalysis.conversationSummary}
                  </p>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-400">
                Enriched at {new Date(enrichment.enrichedAt).toLocaleString()} (v
                {enrichment.enrichmentVersion})
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
