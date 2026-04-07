import { useState, useMemo } from 'react';
import {
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Loader2,
  Lock,
  RefreshCw,
  Database,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Github,
  Server,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useStatus } from '../hooks/useStatus';
import { useSettings, useUpdateSettings, useResetSetting } from '../hooks/useSettings';
import { useRepos, useAddRepo, useUpdateRepo, useDeleteRepo } from '../hooks/useRepos';
import { pollerApi, cleanupApi } from '../api/client';
import { StatusIndicator } from '../components/StatusIndicator';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorAlert } from '../components/ErrorAlert';
import type { SettingItem, Provider, CleanupPreview } from '../types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

// --- Configuration Section ---

interface ConfigSectionProps {
  settings: SettingItem[];
}

function ConfigSection({ settings: allSettings }: ConfigSectionProps) {
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  const updateSettings = useUpdateSettings();
  const resetSetting = useResetSetting();

  const categories = useMemo(() => {
    const map: Record<string, SettingItem[]> = {};
    for (const s of allSettings) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    return map;
  }, [allSettings]);

  const hasEdits = Object.keys(edits).length > 0;

  const handleChange = (key: string, value: unknown) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!hasEdits) return;
    try {
      const res = await updateSettings.mutateAsync(edits);
      const result = res.data.data;
      setEdits({});
      if (result.rejected.length > 0) {
        const errors = result.rejected.map((r) => `${r.key}: ${r.error}`).join('; ');
        setToast({ type: 'warning', message: `Some settings rejected: ${errors}` });
      } else {
        setToast({ type: 'success', message: 'Settings updated -- changes are active immediately.' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save settings.' });
    }
    setTimeout(() => setToast(null), 5000);
  };

  const handleReset = async (key: string) => {
    try {
      await resetSetting.mutateAsync(key);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      setToast({ type: 'error', message: `Failed to reset ${key}.` });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Configuration</h3>
        <p className="text-sm text-gray-500">Manage system settings from the UI.</p>
      </div>

      <div className="p-6 space-y-6">
        {toast && (
          <div
            className={`rounded-md p-3 text-sm ${
              toast.type === 'success'
                ? 'bg-green-50 text-green-800'
                : toast.type === 'warning'
                ? 'bg-amber-50 text-amber-800'
                : 'bg-red-50 text-red-800'
            }`}
          >
            {toast.message}
          </div>
        )}

        {Object.entries(categories).map(([category, items]) => {
          const isCollapsed = collapsedCategories[category];
          return (
            <div key={category}>
              <button
                onClick={() => toggleCategory(category)}
                className="flex items-center gap-2 mb-3"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
                <span className="text-sm font-semibold text-gray-700 capitalize">
                  {category.replace(/_/g, ' ')}
                </span>
              </button>

              {!isCollapsed && (
                <div className="ml-6 space-y-4">
                  {items.map((setting) => (
                    <SettingField
                      key={setting.key}
                      setting={setting}
                      editValue={edits[setting.key]}
                      onChange={(val) => handleChange(setting.key, val)}
                      onReset={() => handleReset(setting.key)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={!hasEdits || updateSettings.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateSettings.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

interface SettingFieldProps {
  setting: SettingItem;
  editValue: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
}

function SettingField({ setting, editValue, onChange, onReset }: SettingFieldProps) {
  const currentVal = editValue !== undefined ? editValue : setting.current_value;

  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-800">{setting.label}</label>
          {!setting.editable && (
            <Lock className="h-3.5 w-3.5 text-gray-400" aria-label="Only changeable via .env file" />
          )}
          {setting.is_overridden && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
              Modified
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{setting.description}</p>

        <div className="mt-2">
          {!setting.editable || setting.sensitive ? (
            <span className="inline-block rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-600 font-mono">
              {String(setting.current_value)}
            </span>
          ) : setting.type === 'boolean' ? (
            <button
              type="button"
              onClick={() => onChange(!currentVal)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                currentVal ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
              role="switch"
              aria-checked={Boolean(currentVal)}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  currentVal ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          ) : setting.type === 'enum' && setting.enumValues ? (
            <select
              value={String(currentVal)}
              onChange={(e) => onChange(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {setting.enumValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : setting.type === 'number' ? (
            <input
              type="number"
              value={String(currentVal)}
              onChange={(e) => onChange(Number(e.target.value))}
              min={setting.min}
              max={setting.max}
              className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          ) : (
            <input
              type="text"
              value={String(currentVal)}
              onChange={(e) => onChange(e.target.value)}
              className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          )}
        </div>
      </div>

      {setting.editable && setting.is_overridden && (
        <button
          onClick={onReset}
          className="mt-6 text-xs text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
        >
          Reset to default
        </button>
      )}
    </div>
  );
}

// --- Tracked Repositories Section ---

function ReposSection() {
  const { data: repos, isLoading, error, refetch } = useRepos();
  const addRepo = useAddRepo();
  const updateRepo = useUpdateRepo();
  const deleteRepo = useDeleteRepo();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoProvider, setNewRepoProvider] = useState<Provider>('github');
  const [newRepoBranch, setNewRepoBranch] = useState('main');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    try {
      await addRepo.mutateAsync({
        full_name: newRepoName.trim(),
        provider: newRepoProvider,
        default_branch: newRepoBranch.trim() || 'main',
      });
      setNewRepoName('');
      setNewRepoBranch('main');
      setShowAddForm(false);
    } catch {
      // Error handled by React Query
    }
  };

  const handleToggle = (id: string, currentActive: boolean) => {
    updateRepo.mutate({ id, body: { is_active: !currentActive } });
  };

  const handleDelete = (id: string) => {
    deleteRepo.mutate(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Tracked Repositories</h3>
          <p className="text-sm text-gray-500">Manage which repositories are monitored.</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Add Repository
        </button>
      </div>

      <div className="p-6">
        {showAddForm && (
          <form onSubmit={handleAdd} className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Provider</label>
                <select
                  value={newRepoProvider}
                  onChange={(e) => setNewRepoProvider(e.target.value as Provider)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                >
                  <option value="github">GitHub</option>
                  <option value="azure_devops">Azure DevOps</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Repository Name</label>
                <input
                  type="text"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  placeholder="org/repo-name"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Default Branch</label>
                <input
                  type="text"
                  value={newRepoBranch}
                  onChange={(e) => setNewRepoBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={addRepo.isPending}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {addRepo.isPending ? 'Adding...' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <LoadingSpinner size="sm" message="Loading repositories..." />
        ) : error ? (
          <ErrorAlert message="Failed to load repositories." onRetry={() => refetch()} />
        ) : !repos || repos.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No repositories tracked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-2">Repository</th>
                  <th className="pb-2">Provider</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Last Polled</th>
                  <th className="pb-2">Reviews</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {repos.map((repo) => (
                  <tr key={repo.id} className="hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-900">{repo.full_name}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1 text-gray-600">
                        {repo.provider === 'github' ? (
                          <Github className="h-4 w-4" />
                        ) : (
                          <Server className="h-4 w-4" />
                        )}
                        {repo.provider === 'github' ? 'GitHub' : 'Azure DevOps'}
                      </span>
                    </td>
                    <td className="py-3">
                      <button
                        onClick={() => handleToggle(repo.id, repo.is_active)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          repo.is_active ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        title={repo.is_active ? 'Active - click to pause' : 'Paused - click to resume'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            repo.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3 text-gray-500">
                      {repo.last_polled_at
                        ? formatDistanceToNow(new Date(repo.last_polled_at), { addSuffix: true })
                        : 'Never'}
                    </td>
                    <td className="py-3 text-gray-600">{repo.review_count}</td>
                    <td className="py-3">
                      {confirmDeleteId === repo.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button
                            onClick={() => handleDelete(repo.id)}
                            className="text-xs font-medium text-red-600 hover:text-red-800"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(repo.id)}
                          className="text-gray-400 hover:text-red-600"
                          title="Delete repository"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- System Status Section ---

function SystemStatusSection() {
  const { data: status, isLoading } = useStatus();
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);

  const handlePoll = async () => {
    setPolling(true);
    setPollResult(null);
    try {
      const res = await pollerApi.triggerPoll();
      const result = res.data.data;
      setPollResult(`Poll complete -- found ${result.new_commits_found} new commit(s) to review.`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 409) {
        setPollResult('A poll is already in progress...');
      } else {
        setPollResult('Failed to trigger poll.');
      }
    } finally {
      setPolling(false);
      setTimeout(() => setPollResult(null), 8000);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-6">
        <LoadingSpinner size="sm" message="Loading status..." />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">System Status</h3>
        <p className="text-sm text-gray-500">Live system health (auto-refreshes every 10s).</p>
      </div>

      <div className="p-6 space-y-4">
        {pollResult && (
          <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">{pollResult}</div>
        )}

        {status && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Uptime</span>
              <p className="font-medium text-gray-900">{formatUptime(status.uptime_seconds)}</p>
            </div>
            <div>
              <span className="text-gray-500">Queue Depth</span>
              <p className="font-medium text-gray-900">{status.queue_depth}</p>
            </div>
            <div>
              <span className="text-gray-500">Claude CLI</span>
              <p>
                <StatusIndicator
                  available={status.claude_cli_available}
                  label={status.claude_cli_available ? 'Available' : 'Not found'}
                />
              </p>
            </div>
            <div>
              <span className="text-gray-500">Total Reviews</span>
              <p className="font-medium text-gray-900">{status.total_reviews_completed}</p>
            </div>
            <div>
              <span className="text-gray-500">Last Poll</span>
              <p className="font-medium text-gray-900">
                {status.last_poll_at
                  ? formatDistanceToNow(new Date(status.last_poll_at), { addSuffix: true })
                  : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Next Poll</span>
              <p className="font-medium text-gray-900">
                {status.next_poll_at
                  ? format(new Date(status.next_poll_at), 'PPp')
                  : 'N/A'}
              </p>
            </div>
            {status.currently_reviewing && (
              <div className="col-span-2 rounded-md bg-indigo-50 p-3">
                <p className="text-xs font-medium text-indigo-800 mb-1">Currently Reviewing</p>
                <p className="text-sm text-indigo-700">
                  {status.currently_reviewing.repo} #{status.currently_reviewing.pr_number}{' '}
                  <code className="font-mono text-xs">
                    ({status.currently_reviewing.commit_sha.slice(0, 7)})
                  </code>
                </p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handlePoll}
          disabled={polling}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {polling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {polling ? 'Polling...' : 'Check for PRs'}
        </button>
      </div>
    </div>
  );
}

// --- Data Retention Section ---

function RetentionSection() {
  const { data: status } = useStatus();
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await cleanupApi.preview();
      setPreview(res.data.data);
    } catch {
      // Silently fail
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const res = await cleanupApi.trigger();
      const result = res.data.data;
      setCleanupResult(
        `Deleted ${result.reviews_deleted} reviews. Database reduced from ${formatBytes(
          result.db_size_before_bytes
        )} to ${formatBytes(result.db_size_after_bytes)}.`
      );
      setConfirmCleanup(false);
      setPreview(null);
    } catch {
      setCleanupResult('Failed to run cleanup.');
    } finally {
      setCleaning(false);
      setTimeout(() => setCleanupResult(null), 8000);
    }
  };

  const retention = status?.retention;
  const storage = status?.storage;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Data Retention & Storage</h3>
        <p className="text-sm text-gray-500">Manage review retention and disk usage.</p>
      </div>

      <div className="p-6 space-y-4">
        {cleanupResult && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">{cleanupResult}</div>
        )}

        {retention && (
          <p className="text-sm text-gray-700">
            {retention.enabled
              ? `Reviews older than ${retention.retention_days} days are automatically deleted daily at 3:00 AM.`
              : 'Automatic cleanup is disabled.'}
          </p>
        )}

        {storage && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-gray-400" />
              <div>
                <span className="text-gray-500">Database Size</span>
                <p className="font-medium text-gray-900">{formatBytes(storage.db_size_bytes)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-gray-400" />
              <div>
                <span className="text-gray-500">Git Clones ({storage.clone_count})</span>
                <p className="font-medium text-gray-900">
                  {formatBytes(storage.total_clone_size_bytes)}
                </p>
              </div>
            </div>
          </div>
        )}

        {retention && retention.pending_deletion.review_count > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">
              {retention.pending_deletion.review_count} reviews pending cleanup
            </p>
            {retention.pending_deletion.oldest_review_date && (
              <p className="text-xs mt-1 text-amber-600">
                Oldest review:{' '}
                {format(new Date(retention.pending_deletion.oldest_review_date), 'PPP')}
              </p>
            )}
          </div>
        )}

        {preview && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="font-medium text-gray-800">
              Cleanup Preview: {preview.reviews_to_delete} of {preview.total_reviews} reviews (
              {preview.percentage_to_delete.toFixed(1)}%) would be deleted.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={loadPreview}
            disabled={loadingPreview}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Preview Cleanup
          </button>

          {!confirmCleanup ? (
            <button
              onClick={() => setConfirmCleanup(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Run Cleanup Now
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5">
              <span className="text-xs text-red-700">
                This will permanently delete reviews. Continue?
              </span>
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="text-xs font-medium text-red-700 hover:text-red-900"
              >
                {cleaning ? 'Running...' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmCleanup(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Settings Page ---

export function Settings() {
  const { data: settingsData, isLoading: settingsLoading, error: settingsError, refetch: refetchSettings } = useSettings();

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
      <p className="mt-1 text-sm text-gray-500">
        Manage configuration, repositories, and system health.
      </p>

      <div className="mt-6 space-y-6">
        {/* Configuration */}
        {settingsLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <LoadingSpinner size="sm" message="Loading settings..." />
          </div>
        ) : settingsError ? (
          <ErrorAlert message="Failed to load settings." onRetry={() => refetchSettings()} />
        ) : settingsData ? (
          <ConfigSection settings={settingsData} />
        ) : null}

        {/* Tracked Repositories */}
        <ReposSection />

        {/* System Status */}
        <SystemStatusSection />

        {/* Data Retention */}
        <RetentionSection />
      </div>
    </div>
  );
}
