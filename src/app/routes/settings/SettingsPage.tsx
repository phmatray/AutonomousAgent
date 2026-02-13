import { CenteredPage, PageHeader } from '@/app/components/PageLayout';

export function SettingsPage() {
  return (
    <CenteredPage width="md">
      <PageHeader
        title="Settings"
        description="General application information"
      />

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-6" aria-labelledby="about-heading">
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
        </dl>
      </section>
    </CenteredPage>
  );
}
