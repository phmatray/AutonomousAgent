import { CenteredPage, PageHeader } from '@/app/components/PageLayout';
import { useRouter } from '@/lib/router';
import { Badge, Button, SectionCard } from '@/components/ui/primitives';

export function SettingsPage() {
  const { navigate } = useRouter();

  return (
    <CenteredPage width="md">
      <PageHeader
        title="Settings"
        description="General application information and operational defaults"
        metadata={(
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">Desktop: Tauri 2.x</Badge>
            <Badge tone="success">Frontend: React 19</Badge>
            <Badge>Theme: Dark Mission Control</Badge>
          </div>
        )}
      />

      <SectionCard aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-lg font-semibold text-white mb-4">
          About
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Version</dt>
            <dd className="text-gray-200">0.1.0</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Engine</dt>
            <dd className="text-gray-200">Tauri 2.x + React 19</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Credentials</dt>
            <dd className="text-gray-200">Manage accounts from the Credentials page.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Storage</dt>
            <dd className="text-gray-200">State and audit data are stored locally.</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard className="mt-4" aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="text-lg font-semibold text-white mb-2">
          Quick Actions
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Jump to key pages for operations and troubleshooting.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('credentials')}>
            Open Credentials
          </Button>
          <Button variant="secondary" onClick={() => navigate('monitoring')}>
            Open Monitoring
          </Button>
          <Button onClick={() => navigate('dashboard')}>
            Open Workflows
          </Button>
        </div>
      </SectionCard>

      <SectionCard className="mt-4" aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="text-lg font-semibold text-white mb-2">
          Keyboard Shortcuts
        </h2>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>Backlog: `j`/`k` move selection, `e` open details, `l` link workflow.</li>
          <li>Editor: `Cmd/Ctrl + S` save, `Cmd/Ctrl + Enter` execute.</li>
          <li>Monitoring: use density toggle to switch compact vs expanded logs.</li>
        </ul>
      </SectionCard>
    </CenteredPage>
  );
}
