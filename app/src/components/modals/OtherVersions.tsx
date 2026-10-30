import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { Button, Group, Row } from '../ui/primitives';
import { APP_VERSION } from '@/config';
import { confirmDialog } from '@/lib/confirm';
import { olderThan } from '@/lib/remote';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';

interface Release {
  version: string;
  date: string;
}

/** Older apps can't read today's saved settings; installing one goes no further back than this. */
const OLDEST = '0.4.0';

/**
 * Settings > Updates > Other versions: install any release, older or newer. For when a new
 * version misbehaves on someone's computer: go back to one that worked. The install uses the
 * release's own signed build, like any update, and keeps you signed in.
 */
export function OtherVersions() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('https://api.github.com/repos/teamcreatovert/infimeety/releases?per_page=20')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { tag_name?: string; draft?: boolean; published_at?: string; assets?: { name: string }[] }[]) =>
        setReleases(
          list
            .filter((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name ?? '') && r.assets?.some((a) => a.name === 'latest.json'))
            .map((r) => ({ version: r.tag_name!.slice(1), date: r.published_at ?? '' }))
            .filter((r) => !olderThan(r.version, OLDEST))
            .slice(0, 8),
        ),
      )
      .catch(() => setReleases([]));
  }, []);

  const install = async (version: string) => {
    const ok = await confirmDialog({
      title: `Install Infimeety ${version}?`,
      body: `It replaces version ${APP_VERSION} and restarts. Automatic updates switch off so it stays on ${version}; switch them back on here anytime. You stay signed in.`,
      confirm: 'Install',
    });
    if (!ok) return;
    setBusy(version);
    useSettings.getState().set({ autoUpdate: false });
    try {
      await invoke('install_version', { version });
    } catch (err) {
      setBusy(null);
      toast({ kind: 'error', title: `Couldn’t install ${version}`, body: String(err) });
    }
  };

  return (
    <Group title="Other versions" footer="If a new version gives you trouble, go back to one that worked. Installing takes a moment and restarts Infimeety.">
      {releases === null ? (
        <Row label="Looking for versions…" />
      ) : releases.length === 0 ? (
        <Row label="Couldn’t load the list of versions" detail="Check your connection and open this again." />
      ) : (
        releases.map((r) => (
          <Row key={r.version} label={`Version ${r.version}`} detail={r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : undefined}>
            {r.version === APP_VERSION ? (
              <span className="text-[12.5px] text-fg-3">You’re on this one</span>
            ) : (
              <Button size="sm" loading={busy === r.version} disabled={!!busy && busy !== r.version} onClick={() => void install(r.version)}>
                Install
              </Button>
            )}
          </Row>
        ))
      )}
    </Group>
  );
}
