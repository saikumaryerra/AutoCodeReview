import { useState } from 'react';
import { ChevronDown, ChevronRight, Bug, Shield, Zap, Paintbrush, Wrench, ThumbsUp, HelpCircle, FileCode } from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { SeverityBadge } from './SeverityBadge';
import type { Finding } from '../types';

const typeIcons: Record<string, React.ReactNode> = {
  bug: <Bug className="h-4 w-4 text-red-500" />,
  security: <Shield className="h-4 w-4 text-orange-500" />,
  performance: <Zap className="h-4 w-4 text-yellow-500" />,
  style: <Paintbrush className="h-4 w-4 text-blue-500" />,
  maintainability: <Wrench className="h-4 w-4 text-gray-500" />,
  praise: <ThumbsUp className="h-4 w-4 text-purple-500" />,
  other: <HelpCircle className="h-4 w-4 text-gray-400" />,
};

interface FindingCardProps {
  finding: Finding;
}

function FindingCard({ finding }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-gray-50"
      >
        <span className="mt-0.5 shrink-0">
          {typeIcons[finding.type] ?? typeIcons.other}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={finding.severity} />
            <span className="text-sm font-medium text-gray-900">{finding.title}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Lines {finding.line_start}
            {finding.line_end !== finding.line_start ? `\u2013${finding.line_end}` : ''}
          </p>
        </div>
        <span className="mt-1 shrink-0 text-gray-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">{finding.description}</p>

          {finding.suggestion && (
            <div className="rounded-md bg-indigo-50 p-3">
              <p className="text-xs font-medium text-indigo-800 mb-1">Suggestion</p>
              <p className="text-sm text-indigo-700">{finding.suggestion}</p>
            </div>
          )}

          {finding.code_snippet && (
            <div className="overflow-hidden rounded-md border border-gray-200">
              <SyntaxHighlighter
                language={finding.language ?? 'typescript'}
                style={atomOneLight}
                customStyle={{ margin: 0, padding: '0.75rem', fontSize: '0.8125rem' }}
                showLineNumbers
                startingLineNumber={finding.line_start}
              >
                {finding.code_snippet}
              </SyntaxHighlighter>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FileGroupProps {
  file: string;
  findings: Finding[];
}

function FileGroup({ file, findings }: FileGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sorted = [...findings].sort((a, b) => a.line_start - b.line_start);

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 py-2 text-left"
      >
        <span className="text-gray-400">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        <FileCode className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-800 font-mono">{file}</span>
        <span className="text-xs text-gray-400">({findings.length})</span>
      </button>
      {!collapsed && (
        <div className="ml-6 space-y-2">
          {sorted.map((finding, i) => (
            <FindingCard key={`${finding.file}-${finding.line_start}-${i}`} finding={finding} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ReviewBodyProps {
  findings: Finding[];
  rawOutput?: string;
}

export function ReviewBody({ findings, rawOutput }: ReviewBodyProps) {
  const [showRaw, setShowRaw] = useState(false);

  const grouped = findings.reduce<Record<string, Finding[]>>((acc, f) => {
    const key = f.file || '(no file)';
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});

  const fileNames = Object.keys(grouped).sort();

  return (
    <div className="space-y-4">
      {fileNames.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No findings in this review.</p>
      ) : (
        fileNames.map((file) => (
          <FileGroup key={file} file={file} findings={grouped[file]} />
        ))
      )}

      {rawOutput && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <span className="text-gray-400">
              {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            Raw Output
          </button>
          {showRaw && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-4 text-xs text-gray-200 leading-relaxed">
              {rawOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
